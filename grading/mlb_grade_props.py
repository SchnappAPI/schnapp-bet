"""
mlb_grade_props.py

MLB prop grading model.

Supported markets (16; see MARKET_CONFIG for the authoritative list):
  batter_rate family  — batter_hits (0.5), batter_total_bases (1.5),
                        batter_home_runs (0.5). Rolling per-PA rates from
                        mlb.player_trend_stats windows.
  batter_count family — batter_rbis, batter_runs_scored, batter_hits_runs_rbis,
                        batter_singles, batter_doubles, batter_triples,
                        batter_walks, batter_strikeouts, batter_stolen_bases.
                        Per-game counts from the mlb.batting_stats boxscore;
                        form component = recent per-game average.
  pitcher family      — pitcher_strikeouts, pitcher_hits_allowed,
                        pitcher_walks, pitcher_earned_runs. Per-start lines
                        from mlb.pitching_stats (note='SP').
  Not graded: batter_first_home_run (ordering market, needs its own model).

Composite grade formula:
  For batter markets:
    composite = 0.40 * form_grade (rolling rate or per-game average)
              + 0.30 * ev_quality_grade
              + 0.30 * matchup_grade

  rolling_hit_rate_grade:
    Weighted hit rate over the batter's rolling windows.
    Uses w60_hit_rate as baseline, w30 as medium-term, w10 as recent form.
    Weights: 0.40 * w60 + 0.35 * w30 + 0.25 * w10 (recency-biased but stable).
    Normalized to 0-100 by dividing by a population ceiling (set empirically;
    MLB hit rate ceiling is ~0.400 for great hitters; TB/PA ceiling is ~0.700).

  ev_quality_grade:
    0.40 * hard_hit_pct (w30) + 0.35 * barrel_pct (w30) + 0.25 * avg_xba (w30).
    Each normalized to population ceiling then scaled 0-100.
    Hard-hit ceiling: 0.60, barrel ceiling: 0.20, xBA ceiling: 0.450.

  matchup_grade:
    For hits/TB: pitcher H/9 (inverted — lower is worse for batter), OBP-against,
    and platoon-adjusted career BvP if >=10 PA.
    For HRs: pitcher HR/9 (higher is better for batter), barrel_pct synergy.
    Scored 0-100.

  For pitcher markets (strikeouts / hits allowed / walks / earned runs):
    composite = 0.50 * season_rate_grade (k_per_9 / h_per_9 / bb_per_9 / era)
              + 0.30 * recent_form (last 5 starts' stat from pitching_stats)
              + 0.20 * opposing_lineup_rate (w30_k_rate / w30_hit_rate /
                       w30_bb_rate average of the opposing starters)
    All rates oriented so a higher rate = a more likely Over.
  For batter_walks / batter_strikeouts / batter_stolen_bases the EV-quality
  term is dropped (0.55 form + 0.45 matchup): quality-of-contact has no or
  inverted signal for speed/walk-driven markets.

KDE tier lines:
  Identical structure to NBA: KDE fitted over a grade-weighted game log window.
  Tier thresholds: safe>=80%, value>=58%, high_risk>=28%, lotto>=7%.
  Minimum prices: high_risk requires +150, lotto requires +400.

Writes to:
  common.daily_grades     — one row per (player_id, event_id, market_key, line_value, outcome_name)
  common.player_tier_lines — one row per (player_id, game_id, market_key) with tier line values

Usage:
  python grading/mlb_grade_props.py [--date YYYY-MM-DD] [--batch N] [--force]
"""

import argparse
import logging
import math
import os
import sys
import time
from datetime import datetime, timezone, timedelta
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.stats import gaussian_kde
from sqlalchemy import create_engine, text

from shared.integrity import validate_and_filter, ensure_tables as ensure_integrity_tables
from grading.calibration_core import load_calibrator, apply_calibrator

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

BOOKMAKER = "fanduel"
# v1.1: market coverage widened 4 -> 16 (batter counting markets + three new
# pitcher markets); v1.0 rows (the original 4 markets) remain valid history.
MODEL_VERSION = "mlb-v1.1"
MIN_SAMPLE = 5  # minimum PA in a window before using it
SEASON_START = "2024-03-20"  # historical floor of player_at_bats (backfill start), NOT the current season

# Rolling window weights (must sum to 1.0)
W10_WEIGHT = 0.25
W30_WEIGHT = 0.35
W60_WEIGHT = 0.40

# Grade component weights
GRADE_HIT_RATE_WEIGHT = 0.40
GRADE_EV_WEIGHT = 0.30
GRADE_MATCHUP_WEIGHT = 0.30

# Population ceilings for normalization (empirical MLB 2023-2026 data)
CEIL_HIT_RATE = 0.370  # MLB batting avg ceiling for normalization
CEIL_TB_PER_PA = 0.650  # total bases per PA ceiling
CEIL_HR_RATE = 0.080  # home run rate ceiling
CEIL_HARD_HIT = 0.600  # hard-hit % ceiling
CEIL_BARREL = 0.200  # barrel % ceiling
CEIL_XBA = 0.420  # xBA ceiling
CEIL_K9 = 14.0  # pitcher K/9 ceiling (elite SP)
CEIL_LINEUP_K = 0.300  # opposing lineup aggregate K rate ceiling

# Minimum career BvP PA before using it in matchup grade
MIN_BVP_PA = 10

# KDE parameters (mirrors NBA grade_props.py)
KDE_WINDOW_HOT = 15
KDE_WINDOW_MID = 30
KDE_WINDOW_COLD = 60
KDE_MIN_GAMES = 5
KDE_THIN_SAMPLE_PROB_CAP = 0.85

TIER_SAFE_PROB = 0.80
TIER_VALUE_PROB = 0.58
TIER_HIGHRISK_PROB = 0.28
TIER_LOTTO_PROB = 0.07

BATCH_DEFAULT = 20

# Market config. Three families:
#   batter_rate  - per-at-bat markets whose rolling rates live in
#                  mlb.player_trend_stats windows (hits, TB, HR). Game logs
#                  come from mlb.player_at_bats.
#   batter_count - per-game counting markets with no trend-window rates
#                  (RBI, runs, walks, ...). Game logs come straight from the
#                  mlb.batting_stats boxscore; the form component of the
#                  composite is the recent per-game average normalized by
#                  avg_ceil (empirical strong-hitter per-game ceilings).
#   pitcher      - SP markets. Game logs from mlb.pitching_stats (note='SP');
#                  composite = 0.50 season rate + 0.30 recent form + 0.20
#                  opposing-lineup rate (see compute_pitcher_market_grade).
# "expr" is a trusted SQL expression over the source table (config-only,
# never user input). standard_line None = line varies, read from odds.
# NOTE: standard_line is documentation - the authoritative point filter is
# the hand-written WHERE clause in fetch_upcoming_mlb_props. Change both.
# batter_first_home_run is deliberately NOT graded: it is an ordering market
# (first HR of the game), not a counting market, and needs its own model.
MARKET_CONFIG = {
    "batter_hits": {"family": "batter_rate", "source": "at_bats", "stat": "hits", "standard_line": 0.5},
    "batter_total_bases": {"family": "batter_rate", "source": "at_bats", "stat": "total_bases", "standard_line": 1.5},
    "batter_home_runs": {"family": "batter_rate", "source": "at_bats", "stat": "home_runs", "standard_line": 0.5},
    "batter_rbis": {
        "family": "batter_count",
        "source": "boxscore",
        "expr": "rbi",
        "standard_line": 0.5,
        "avg_ceil": 1.20,
    },
    "batter_runs_scored": {
        "family": "batter_count",
        "source": "boxscore",
        "expr": "runs",
        "standard_line": 0.5,
        "avg_ceil": 1.00,
    },
    "batter_hits_runs_rbis": {
        "family": "batter_count",
        "source": "boxscore",
        "expr": "(hits + runs + rbi)",
        "standard_line": None,
        "avg_ceil": 3.20,
    },
    "batter_singles": {
        "family": "batter_count",
        "source": "boxscore",
        "expr": "(hits - doubles - triples - home_runs)",
        "standard_line": 0.5,
        "avg_ceil": 1.10,
    },
    "batter_doubles": {
        "family": "batter_count",
        "source": "boxscore",
        "expr": "doubles",
        "standard_line": 0.5,
        "avg_ceil": 0.45,
    },
    "batter_triples": {
        "family": "batter_count",
        "source": "boxscore",
        "expr": "triples",
        "standard_line": 0.5,
        "avg_ceil": 0.12,
    },
    "batter_walks": {
        "family": "batter_count",
        "source": "boxscore",
        "expr": "walks",
        "standard_line": 0.5,
        "avg_ceil": 0.90,
    },
    "batter_strikeouts": {
        "family": "batter_count",
        "source": "boxscore",
        "expr": "strikeouts",
        "standard_line": 0.5,
        "avg_ceil": 1.60,
    },
    "batter_stolen_bases": {
        "family": "batter_count",
        "source": "boxscore",
        "expr": "stolen_bases",
        "standard_line": 0.5,
        "avg_ceil": 0.50,
    },
    "pitcher_strikeouts": {
        "family": "pitcher",
        "source": "pitching",
        "expr": "strikeouts",
        "standard_line": None,
        "season_rate": "k_per_9",
        "rate_ceil": CEIL_K9,
        "rate_floor": 5.0,
        "recent_ceil": 10.0,
        "recent_floor": 3.0,
        "opp_rate_col": "w30_k_rate",
        "opp_ceil": CEIL_LINEUP_K,
        "opp_floor": 0.10,
    },
    "pitcher_hits_allowed": {
        "family": "pitcher",
        "source": "pitching",
        "expr": "hits_allowed",
        "standard_line": None,
        "season_rate": "h_per_9",
        "rate_ceil": 12.0,
        "rate_floor": 5.0,
        "recent_ceil": 9.0,
        "recent_floor": 2.0,
        "opp_rate_col": "w30_hit_rate",
        "opp_ceil": CEIL_HIT_RATE,
        "opp_floor": 0.180,
    },
    "pitcher_walks": {
        "family": "pitcher",
        "source": "pitching",
        "expr": "walks",
        "standard_line": None,
        "season_rate": "bb_per_9",
        "rate_ceil": 5.5,
        "rate_floor": 1.0,
        "recent_ceil": 5.0,
        "recent_floor": 0.5,
        "opp_rate_col": "w30_bb_rate",
        "opp_ceil": 0.14,
        "opp_floor": 0.04,
    },
    "pitcher_earned_runs": {
        "family": "pitcher",
        "source": "pitching",
        "expr": "earned_runs",
        "standard_line": None,
        "season_rate": "era",
        "rate_ceil": 6.5,
        "rate_floor": 2.0,
        "recent_ceil": 6.0,
        "recent_floor": 1.0,
        "opp_rate_col": "w30_hit_rate",
        "opp_ceil": CEIL_HIT_RATE,
        "opp_floor": 0.180,
    },
}


# ---------------------------------------------------------------------------
# DB helpers
# ---------------------------------------------------------------------------


def get_engine(max_retries=3, retry_wait=60):
    conn_str = (
        f"mssql+pyodbc://{os.environ['SQL_USERNAME']}:"
        f"{os.environ['SQL_PASSWORD']}@"
        f"{os.environ['SQL_SERVER']}/"
        f"{os.environ['SQL_DATABASE']}"
        "?driver=ODBC+Driver+18+for+SQL+Server"
        f"&Encrypt=yes&TrustServerCertificate={os.environ.get('SQL_TRUST_CERT', 'no')}"
        "&Connection+Timeout=90"
    )
    engine = create_engine(conn_str, fast_executemany=True)
    for attempt in range(1, max_retries + 1):
        try:
            with engine.connect() as conn:
                conn.execute(text("SELECT 1"))
            log.info("DB connected.")
            return engine
        except Exception as exc:
            log.warning("DB attempt %d/%d: %s", attempt, max_retries, exc)
            if attempt < max_retries:
                time.sleep(retry_wait)
    raise RuntimeError("Could not connect after retries.")


def today_ct() -> str:
    return datetime.now(timezone.utc).astimezone(timezone(timedelta(hours=-5))).strftime("%Y-%m-%d")


# ---------------------------------------------------------------------------
# Data fetching
# ---------------------------------------------------------------------------


def fetch_upcoming_mlb_props(engine, grade_date: str) -> pd.DataFrame:
    """
    Pull upcoming MLB player props for grade_date from odds tables.
    FanDuel structures standard batter lines as _alternate markets (e.g.
    batter_hits_alternate at outcome_point 0.5). We fetch the standard-line
    rows from those alternate markets and map them back to canonical keys.

    Standard lines used:
      batter_hits_alternate          @ 0.5  -> batter_hits
      batter_total_bases_alternate   @ 1.5  -> batter_total_bases
      batter_home_runs_alternate     @ 0.5  -> batter_home_runs
      pitcher_strikeouts             (any)  -> pitcher_strikeouts
    """
    df = pd.read_sql(
        text("""
        SELECT
            e.event_id,
            CAST(egm.game_id AS INT) AS game_pk,
            e.commence_time,
            e.home_team,
            e.away_team,
            CASE pp.market_key
                WHEN 'batter_hits_alternate'         THEN 'batter_hits'
                WHEN 'batter_total_bases_alternate'  THEN 'batter_total_bases'
                WHEN 'batter_home_runs_alternate'    THEN 'batter_home_runs'
                WHEN 'batter_rbis_alternate'         THEN 'batter_rbis'
                WHEN 'batter_runs_scored_alternate'  THEN 'batter_runs_scored'
                WHEN 'batter_singles_alternate'      THEN 'batter_singles'
                WHEN 'batter_doubles_alternate'      THEN 'batter_doubles'
                WHEN 'batter_triples_alternate'      THEN 'batter_triples'
                ELSE pp.market_key
            END                AS market_key,
            pp.player_name,
            pp.player_id,
            pp.outcome_name,
            pp.outcome_point   AS line_value,
            pp.outcome_price,
            pp.bookmaker_key
        FROM odds.upcoming_player_props pp
        JOIN odds.upcoming_events e
            ON pp.event_id = e.event_id
        LEFT JOIN odds.event_game_map egm
            ON egm.event_id = e.event_id
        WHERE e.sport_key = 'baseball_mlb'
          AND pp.bookmaker_key = :bookmaker
          AND (
              -- FanDuel posts standard batter lines inside _alternate markets;
              -- take each market's standard point only (KDE tiers cover the
              -- rest of the ladder). Non-alternate keys carry their own line.
              (pp.market_key = 'batter_hits_alternate'        AND pp.outcome_point = 0.5)
           OR (pp.market_key = 'batter_total_bases_alternate' AND pp.outcome_point = 1.5)
           OR (pp.market_key = 'batter_home_runs_alternate'   AND pp.outcome_point = 0.5)
           OR (pp.market_key = 'batter_rbis_alternate'        AND pp.outcome_point = 0.5)
           OR (pp.market_key = 'batter_runs_scored_alternate' AND pp.outcome_point = 0.5)
           OR (pp.market_key = 'batter_singles_alternate'     AND pp.outcome_point = 0.5)
           OR (pp.market_key = 'batter_doubles_alternate'     AND pp.outcome_point = 0.5)
           OR (pp.market_key = 'batter_triples_alternate'     AND pp.outcome_point = 0.5)
           OR  pp.market_key IN ('batter_walks', 'batter_strikeouts',
                                 'batter_stolen_bases', 'batter_hits_runs_rbis',
                                 'pitcher_strikeouts', 'pitcher_hits_allowed',
                                 'pitcher_walks', 'pitcher_earned_runs')
          )
          AND pp.outcome_name IN ('Over','Under')
          AND CAST(e.commence_time AS DATE) = :grade_date
        ORDER BY e.commence_time, pp.market_key, pp.player_name
    """),
        engine,
        params={"bookmaker": BOOKMAKER, "grade_date": grade_date},
    )

    log.info("Upcoming props: %d rows for %s.", len(df), grade_date)
    return df


def fetch_trend_stats(engine, player_ids: list, grade_date: str) -> pd.DataFrame:
    """Most-recent player_trend_stats row per player entering grade_date."""
    if not player_ids:
        return pd.DataFrame()
    plist = ", ".join(str(p) for p in player_ids)
    df = pd.read_sql(
        text(f"""
        SELECT ts.*
        FROM mlb.player_trend_stats ts
        INNER JOIN (
            SELECT batter_id, MAX(game_date) AS latest_date
            FROM mlb.player_trend_stats
            WHERE batter_id IN ({plist})
              AND game_date < :grade_date
            GROUP BY batter_id
        ) latest ON ts.batter_id = latest.batter_id AND ts.game_date = latest.latest_date
    """),
        engine,
        params={"grade_date": grade_date},
    )
    log.info("Trend stats: %d rows.", len(df))
    return df


def fetch_bvp_for_games(engine, matchups: list) -> pd.DataFrame:
    """
    matchups: list of (batter_id, pitcher_id) tuples.
    Returns career BvP rows for those pairs.
    SQL Server doesn't support tuple-IN so we filter in Python after fetching
    all involved batter_ids.
    """
    if not matchups:
        return pd.DataFrame()
    batter_ids = list({m[0] for m in matchups if m[0]})
    if not batter_ids:
        return pd.DataFrame()
    plist = ", ".join(str(b) for b in batter_ids)
    df = pd.read_sql(
        text(f"""
        SELECT batter_id, pitcher_id, plate_appearances, at_bats, hits,
               home_runs, walks, strikeouts, batting_avg, obp, slg, ops,
               total_bases, last_faced_date
        FROM mlb.career_batter_vs_pitcher
        WHERE batter_id IN ({plist})
    """),
        engine,
    )
    # Filter to requested pairs
    pair_set = set(matchups)
    df = df[df.apply(lambda r: (r["batter_id"], r["pitcher_id"]) in pair_set, axis=1)]
    log.info("BvP: %d matching pairs.", len(df))
    return df


def fetch_pitcher_season_stats(engine, pitcher_ids: list) -> pd.DataFrame:
    if not pitcher_ids:
        return pd.DataFrame()
    plist = ", ".join(str(p) for p in pitcher_ids)
    df = pd.read_sql(
        text(f"""
        SELECT player_id AS pitcher_id, k_per_9, bb_per_9, h_per_9, era, whip,
               batting_avg_against, obp_against, slg_against, ops_against,
               hr_per_9, strikeouts, innings_pitched, games_started, season_year
        FROM mlb.pitcher_season_stats
        WHERE player_id IN ({plist})
        ORDER BY season_year DESC
    """),
        engine,
    )
    # Keep most recent season per pitcher
    df = df.sort_values("season_year", ascending=False).drop_duplicates("pitcher_id")
    log.info("Pitcher season stats: %d rows.", len(df))
    return df


def fetch_game_log(engine, player_id: int, market_key: str, grade_date: str, n_games: int = 60) -> pd.DataFrame:
    """
    Per-game stat history for a market, newest first.
      at_bats  (batter_rate) - aggregated from mlb.player_at_bats events.
      boxscore (batter_count) - straight from mlb.batting_stats columns.
      pitching (pitcher)     - from mlb.pitching_stats, starts only.
    Returns DataFrame with columns [game_date, stat_value].
    The cfg "expr" values are trusted config constants, never user input.
    """
    cfg = MARKET_CONFIG[market_key]
    source = cfg.get("source", "at_bats")

    if source == "pitching":
        df = pd.read_sql(
            text(f"""
            SELECT ps.game_date, ps.{cfg["expr"]} AS stat_value
            FROM mlb.pitching_stats ps
            WHERE ps.player_id = :player_id
              AND ps.game_date < :grade_date
              AND ps.note = 'SP'
            ORDER BY ps.game_date DESC
        """),
            engine,
            params={"player_id": player_id, "grade_date": grade_date},
        )
        return df.head(n_games)
    elif source == "boxscore":
        df = pd.read_sql(
            text(f"""
            SELECT bs.game_date, {cfg["expr"]} AS stat_value
            FROM mlb.batting_stats bs
            WHERE bs.player_id = :player_id
              AND bs.game_date < :grade_date
            ORDER BY bs.game_date DESC
        """),
            engine,
            params={"player_id": player_id, "grade_date": grade_date},
        )
        return df.head(n_games)
    else:
        df = pd.read_sql(
            text("""
            SELECT ab.game_date,
                   SUM(CASE WHEN ab.result_event_type IN ('single','double','triple','home_run') THEN 1 ELSE 0 END) AS hits,
                   SUM(CASE ab.result_event_type WHEN 'single' THEN 1 WHEN 'double' THEN 2
                                                 WHEN 'triple' THEN 3 WHEN 'home_run' THEN 4
                            ELSE 0 END) AS total_bases,
                   SUM(CASE WHEN ab.result_event_type = 'home_run' THEN 1 ELSE 0 END) AS home_runs
            FROM mlb.player_at_bats ab
            WHERE ab.batter_id = :player_id
              AND ab.game_date < :grade_date
              AND ab.result_event_type NOT IN (
                'caught_stealing_2b','caught_stealing_3b','caught_stealing_home',
                'pickoff_1b','pickoff_2b','pickoff_caught_stealing_2b',
                'pickoff_caught_stealing_3b','pickoff_caught_stealing_home',
                'pickoff_error_1b','stolen_base_2b','wild_pitch')
            GROUP BY ab.game_date
            ORDER BY ab.game_date DESC
        """),
            engine,
            params={"player_id": player_id, "grade_date": grade_date},
        )
        stat_col = cfg["stat"]
        df = df.rename(columns={stat_col: "stat_value"})
        return df.head(n_games)[["game_date", "stat_value"]]


def fetch_opposing_lineup_rate(
    engine, game_pk: int, is_pitcher_home: bool, grade_date: str, rate_col: str = "w30_k_rate"
) -> float | None:
    """
    Average of a w30 trend rate across the opposing lineup's starters.
    rate_col comes from MARKET_CONFIG (trusted constant): w30_k_rate for
    pitcher Ks, w30_hit_rate for hits-allowed/ERA, w30_bb_rate for walks.
    """
    if rate_col not in ("w30_k_rate", "w30_hit_rate", "w30_bb_rate"):
        raise ValueError(f"unsupported lineup rate column: {rate_col}")

    df = pd.read_sql(
        text(f"""
        SELECT AVG(ts.{rate_col}) AS avg_k_rate
        FROM mlb.player_trend_stats ts
        INNER JOIN (
            SELECT batter_id, MAX(game_date) AS latest_date
            FROM mlb.player_trend_stats
            WHERE game_date < :grade_date
            GROUP BY batter_id
        ) latest ON ts.batter_id = latest.batter_id AND ts.game_date = latest.latest_date
        INNER JOIN (
            SELECT DISTINCT bs.player_id
            FROM mlb.batting_stats bs
            JOIN mlb.games g ON g.game_pk = bs.game_pk
            WHERE bs.game_pk = :game_pk
              AND bs.batting_order % 100 = 0
        ) starters ON starters.player_id = ts.batter_id
        WHERE ts.{rate_col} IS NOT NULL
    """),
        engine,
        params={"game_pk": game_pk, "grade_date": grade_date},
    )

    val = df["avg_k_rate"].iloc[0] if not df.empty else None
    return float(val) if val is not None and not pd.isna(val) else None


# ---------------------------------------------------------------------------
# Grading logic
# ---------------------------------------------------------------------------


def clamp(v, lo=0.0, hi=100.0):
    return max(lo, min(hi, v))


def normalize(val, ceiling, floor=0.0) -> float:
    """Linear normalization to 0-100 given a floor and ceiling."""
    if val is None or pd.isna(val):
        return 50.0  # neutral when no data
    return clamp((val - floor) / (ceiling - floor) * 100.0)


def weighted_rate(ts: pd.Series, col_prefix: str, w10=W10_WEIGHT, w30=W30_WEIGHT, w60=W60_WEIGHT) -> float | None:
    """Blend three window rates, falling back gracefully when windows are thin."""
    v10 = ts.get(f"w10_{col_prefix}")
    v30 = ts.get(f"w30_{col_prefix}")
    v60 = ts.get(f"w60_{col_prefix}")
    n10 = ts.get("w10_pa", 0) or 0
    n30 = ts.get("w30_pa", 0) or 0
    n60 = ts.get("w60_pa", 0) or 0

    total_w = 0.0
    total_v = 0.0
    for v, n, w in [(v10, n10, w10), (v30, n30, w30), (v60, n60, w60)]:
        if v is not None and not pd.isna(v) and n >= MIN_SAMPLE:
            total_v += v * w
            total_w += w

    return total_v / total_w if total_w > 0 else None


def compute_hit_rate_grade(ts: pd.Series, market_key: str) -> float:
    """
    Rolling hit-rate grade (0-100) for the given market.
    For HR market we use home_runs/pa derived from window counts.
    """
    if market_key in ("batter_hits", "batter_total_bases"):
        col = "hit_rate" if market_key == "batter_hits" else "tb_per_pa"
        ceil = CEIL_HIT_RATE if market_key == "batter_hits" else CEIL_TB_PER_PA
        rate = weighted_rate(ts, col)
    elif market_key == "batter_home_runs":
        # Derive HR rate from window counts
        rates = []
        weights = []
        for w, wt in [(10, W10_WEIGHT), (30, W30_WEIGHT), (60, W60_WEIGHT)]:
            hrs = ts.get(f"w{w}_home_runs", 0) or 0
            pa = ts.get(f"w{w}_pa", 0) or 0
            if pa >= MIN_SAMPLE:
                rates.append(hrs / pa * wt)
                weights.append(wt)
        rate = sum(rates) / sum(weights) if weights else None
        ceil = CEIL_HR_RATE
    else:
        return 50.0  # pitcher market — not used here

    return normalize(rate, ceil) if rate is not None else 50.0


def compute_game_avg_grade(game_log: pd.DataFrame, cfg: dict, n_games: int = 30) -> float:
    """
    Form grade for batter_count markets (no trend-window rates exist for
    RBI/runs/walks/etc). Recent per-game average over the last n_games,
    normalized against the market's empirical strong-hitter ceiling.
    Neutral 50 when the log is too thin to mean anything.
    """
    if game_log.empty or len(game_log) < MIN_SAMPLE:
        return 50.0
    avg = pd.to_numeric(game_log["stat_value"].head(n_games), errors="coerce").mean()
    return normalize(avg, cfg["avg_ceil"])


def compute_ev_grade(ts: pd.Series) -> float:
    """EV quality grade from w30 hard-hit %, barrel %, and xBA."""
    hh = ts.get("w30_hard_hit_pct")
    brr = ts.get("w30_barrel_pct")
    xba = ts.get("w30_avg_xba")

    hh_grade = normalize(hh, CEIL_HARD_HIT) if hh is not None else 50.0
    brr_grade = normalize(brr, CEIL_BARREL) if brr is not None else 50.0
    xba_grade = normalize(xba, CEIL_XBA) if xba is not None else 50.0

    return 0.40 * hh_grade + 0.35 * brr_grade + 0.25 * xba_grade


def compute_batter_matchup_grade(
    pitcher_stats: pd.Series | None, bvp: pd.Series | None, ts: pd.Series, market_key: str, pitcher_hand: str | None
) -> float:
    """
    Matchup grade (0-100) for batter props.
    Combines pitcher season stats, career BvP (if >=MIN_BVP_PA),
    and platoon split from trend stats.
    """
    components = []

    # Market groups sharing a pitcher-quality signal. Contact-driven counting
    # markets (RBI/runs/singles/doubles/triples/H+R+RBI) follow the hits
    # signal (H/9 + OBP-against); home runs keep their own HR/9 + OPS branch.
    _HITS_LIKE = (
        "batter_hits",
        "batter_total_bases",
        "batter_rbis",
        "batter_runs_scored",
        "batter_hits_runs_rbis",
        "batter_singles",
        "batter_doubles",
        "batter_triples",
    )

    if pitcher_stats is not None:
        if market_key == "batter_walks":
            # Walk-prone pitcher raises the Over.
            bb9 = pitcher_stats.get("bb_per_9")
            if bb9 is not None and not pd.isna(bb9):
                components.append(normalize(float(bb9), ceiling=5.5, floor=1.0) * 0.60)
        elif market_key == "batter_strikeouts":
            # High-K pitcher raises the batter-strikeout Over.
            k9 = pitcher_stats.get("k_per_9")
            if k9 is not None and not pd.isna(k9):
                components.append(normalize(float(k9), ceiling=CEIL_K9, floor=5.0) * 0.60)
        elif market_key == "batter_stolen_bases":
            # No reliable pitcher signal ingested for SB; leave to form + EV.
            pass
        elif market_key in _HITS_LIKE:
            # H/9 inverted: lower H/9 = tougher pitcher = lower grade
            h9 = pitcher_stats.get("h_per_9")
            if h9 is not None and not pd.isna(h9):
                # Population range: ~5 (elite) to ~12 (bad). Normalize inverted.
                h9_grade = normalize(float(h9), ceiling=12.0, floor=5.0)
                components.append(h9_grade * 0.40)
            obp_ag = pitcher_stats.get("obp_against")
            if obp_ag is not None and not pd.isna(obp_ag):
                obp_grade = normalize(float(obp_ag), ceiling=0.380, floor=0.270)
                components.append(obp_grade * 0.35)
        elif market_key == "batter_home_runs":
            hr9 = pitcher_stats.get("hr_per_9")
            if hr9 is not None and not pd.isna(hr9):
                # Population range: ~0.5 (elite) to ~2.5 (homer prone)
                hr9_grade = normalize(float(hr9), ceiling=2.5, floor=0.5)
                components.append(hr9_grade * 0.60)
            ops_ag = pitcher_stats.get("ops_against")
            if ops_ag is not None and not pd.isna(ops_ag):
                ops_grade = normalize(float(ops_ag), ceiling=0.850, floor=0.600)
                components.append(ops_grade * 0.40)

    # Career BvP
    if bvp is not None and bvp.get("plate_appearances", 0) >= MIN_BVP_PA:
        bvp_rate = bvp.get("batting_avg")
        if bvp_rate is not None and not pd.isna(bvp_rate):
            bvp_grade = normalize(float(bvp_rate), ceiling=0.400, floor=0.150)
            components.append(bvp_grade * 0.25)

    # Platoon split adjustment
    if pitcher_hand in ("L", "R"):
        split_col = "vs_lhp_hit_rate" if pitcher_hand == "L" else "vs_rhp_hit_rate"
        split_pa_col = "vs_lhp_pa" if pitcher_hand == "L" else "vs_rhp_pa"
        split_rate = ts.get(split_col)
        split_pa = ts.get(split_pa_col, 0) or 0
        if split_rate is not None and not pd.isna(split_rate) and split_pa >= 20:
            ceil = CEIL_HIT_RATE if market_key != "batter_home_runs" else CEIL_HR_RATE
            split_grade = normalize(float(split_rate), ceiling=ceil)
            if components:  # blend in at 15% weight
                components.append(split_grade * 0.15)
            else:
                components.append(split_grade)

    if not components:
        return 50.0

    # Re-normalize so weights sum to 1 (they may not given conditional adds)
    total_w = sum(abs(c) for c in components)
    return clamp(sum(components) / total_w * 100.0) if total_w > 0 else 50.0


def compute_pitcher_market_grade(
    cfg: dict, pitcher_stats: pd.Series | None, recent_form: pd.DataFrame, opp_lineup_rate: float | None
) -> float:
    """
    Composite grade for pitcher props (Ks, hits allowed, walks, earned runs).
    0.50 season rate (k_per_9 / h_per_9 / bb_per_9 / era) + 0.30 recent
    per-start form + 0.20 opposing-lineup rate. All rates are oriented so a
    higher rate means a more likely Over (a hittable pitcher allows more
    hits; a wild one more walks), matching the original K-grade orientation.
    """
    season_grade = 50.0
    if pitcher_stats is not None:
        rate = pitcher_stats.get(cfg["season_rate"])
        if rate is not None and not pd.isna(rate):
            season_grade = normalize(float(rate), ceiling=cfg["rate_ceil"], floor=cfg["rate_floor"])

    recent_grade = 50.0
    if not recent_form.empty and len(recent_form) >= 3:
        recent_avg = pd.to_numeric(recent_form["stat_value"].head(5), errors="coerce").mean()
        recent_grade = normalize(recent_avg, ceiling=cfg["recent_ceil"], floor=cfg["recent_floor"])

    opp_grade = 50.0
    if opp_lineup_rate is not None:
        opp_grade = normalize(opp_lineup_rate, ceiling=cfg["opp_ceil"], floor=cfg["opp_floor"])

    return 0.50 * season_grade + 0.30 * recent_grade + 0.20 * opp_grade


def compute_composite(hit_rate_grade: float, ev_grade: float, matchup_grade: float, no_ev: bool = False) -> float:
    if no_ev:
        # Markets where quality-of-contact has no (or inverted) signal:
        # walks, batter strikeouts, stolen bases. Burner/slap-hitter
        # archetypes have low exit velo, so weighting statcast EV there
        # pushes the grade the wrong way for exactly the players who steal
        # bases / draw walks. Redistribute EV's weight to form + matchup.
        return 0.55 * hit_rate_grade + 0.45 * matchup_grade
    return GRADE_HIT_RATE_WEIGHT * hit_rate_grade + GRADE_EV_WEIGHT * ev_grade + GRADE_MATCHUP_WEIGHT * matchup_grade


# ---------------------------------------------------------------------------
# KDE tier line computation
# ---------------------------------------------------------------------------


def american_to_implied(price: int) -> float:
    if price >= 0:
        return 100.0 / (price + 100.0)
    return abs(price) / (abs(price) + 100.0)


def implied_to_american(prob: float) -> int:
    if prob <= 0 or prob >= 1:
        return 0
    if prob >= 0.5:
        return -round(prob / (1 - prob) * 100)
    return round((1 - prob) / prob * 100)


def ev(prob: float, price: int) -> float:
    implied = american_to_implied(price)
    return prob / implied - 1.0


def compute_kde_tier_lines(game_log: pd.DataFrame, composite: float, market_key: str, calibrator=None) -> dict:
    """
    Fit a KDE over the grade-weighted game log. Return safe/value/highrisk/lotto
    lines and their probabilities. Lines are rounded to the nearest 0.5.
    Returns empty dict if insufficient data.

    calibrator: optional callable raw_prob -> calibrated prob (the sport='mlb'
    entry in common.grade_calibration). Tier selection and the stored
    probabilities both use the calibrated value, matching NBA semantics.
    """
    if game_log.empty or len(game_log) < KDE_MIN_GAMES:
        return {}

    # Select window size based on composite grade
    if composite >= 80:
        window = KDE_WINDOW_HOT
    elif composite >= 50:
        window = KDE_WINDOW_MID
    else:
        window = KDE_WINDOW_COLD

    df = game_log.head(window).copy()
    n = len(df)

    values = df["stat_value"].astype(float).values

    if n < KDE_MIN_GAMES:
        # Fall back to normal distribution
        mu, sigma = float(np.mean(values)), float(np.std(values))
        if sigma < 0.01:
            sigma = 0.5

        def prob_over(line):
            from scipy.stats import norm

            p = 1 - norm.cdf(line, loc=mu, scale=sigma)
            return min(p, KDE_THIN_SAMPLE_PROB_CAP)
    else:
        # Reflect at 0 to prevent negative probability mass
        reflected = np.concatenate([values, -values])
        try:
            kde = gaussian_kde(reflected)
        except Exception:
            return {}

        def prob_over(line):
            p = float(kde.integrate_box_1d(line, np.inf) * 2)
            return min(max(p, 0.0), 1.0)

    # Scan candidate lines in 0.5 increments
    results = {}
    max_line = max(values) + 3.0

    for prob_thresh, label in [
        (TIER_SAFE_PROB, "safe"),
        (TIER_VALUE_PROB, "value"),
        (TIER_HIGHRISK_PROB, "highrisk"),
        (TIER_LOTTO_PROB, "lotto"),
    ]:
        candidate = None
        line = 0.5
        while line <= max_line:
            p = prob_over(line)
            if calibrator is not None:
                p = float(calibrator(p))
            if p >= prob_thresh:
                candidate = (line, p)
            line += 0.5
        results[label] = candidate

    return results


# ---------------------------------------------------------------------------
# Output writers
# ---------------------------------------------------------------------------


def ensure_schema(engine):
    """Confirm common.daily_grades and common.player_tier_lines exist.
    These are owned by the NBA grading system; we just write to them.
    Also widens game_id to VARCHAR(50) if it was created narrower (NBA used 15)."""
    with engine.begin() as conn:
        for tbl in ("common.daily_grades", "common.player_tier_lines"):
            exists = conn.execute(
                text("SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA + '.' + TABLE_NAME = :t"), {"t": tbl}
            ).fetchone()
            if not exists:
                raise RuntimeError(f"{tbl} does not exist. Run the NBA grading setup first.")
        # Widen game_id if needed — MLB event IDs are 32 chars; NBA created this as VARCHAR(15)
        for tbl in ("common.daily_grades", "common.player_tier_lines"):
            schema, table = tbl.split(".")
            row = conn.execute(
                text(
                    "SELECT CHARACTER_MAXIMUM_LENGTH FROM INFORMATION_SCHEMA.COLUMNS "
                    "WHERE TABLE_SCHEMA = :s AND TABLE_NAME = :t AND COLUMN_NAME = 'game_id'"
                ),
                {"s": schema, "t": table},
            ).fetchone()
            if row and row[0] < 50:
                conn.execute(text(f"ALTER TABLE {tbl} ALTER COLUMN game_id VARCHAR(50)"))
                log.info("Widened %s.game_id to VARCHAR(50).", tbl)
    log.info("Schema check passed.")


def upsert_daily_grades(engine, rows: list[dict]):
    if not rows:
        return
    with engine.begin() as conn:
        conn.execute(
            text("""
            IF OBJECT_ID('tempdb..#stage_grades') IS NOT NULL DROP TABLE #stage_grades;
            CREATE TABLE #stage_grades (
                grade_date      DATE,
                event_id        VARCHAR(50),
                game_id         VARCHAR(50),
                player_id       BIGINT,
                player_name     NVARCHAR(100),
                market_key      VARCHAR(100),
                bookmaker_key   VARCHAR(50),
                line_value      DECIMAL(6,1),
                outcome_name    VARCHAR(5),
                over_price      INT,
                outcome         VARCHAR(5),
                composite_grade FLOAT,
                model_version   VARCHAR(50),
                sample_size_60  INT,
                sport           VARCHAR(10)
            );
        """)
        )
        batch = [
            (
                r["grade_date"],
                r["event_id"],
                r.get("game_id"),
                r["player_id"],
                r["player_name"],
                r["market_key"],
                r.get("bookmaker_key", BOOKMAKER),
                r["line_value"],
                r["outcome_name"],
                r.get("over_price"),
                r.get("outcome"),
                r["composite_grade"],
                MODEL_VERSION,
                r.get("sample_size_60"),
                "mlb",
            )
            for r in rows
        ]
        conn.exec_driver_sql("INSERT INTO #stage_grades VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", batch)
        conn.execute(
            text("""
            MERGE common.daily_grades AS t
            USING #stage_grades AS s
            ON t.player_id = s.player_id
               AND t.event_id = s.event_id
               AND t.market_key = s.market_key
               AND t.line_value = s.line_value
               AND t.outcome_name = s.outcome_name
            WHEN MATCHED THEN UPDATE SET
                t.composite_grade = s.composite_grade,
                t.over_price      = s.over_price,
                t.model_version   = s.model_version,
                t.sample_size_60  = s.sample_size_60,
                t.sport           = s.sport
            WHEN NOT MATCHED THEN INSERT (
                grade_date, event_id, game_id, player_id, player_name,
                market_key, bookmaker_key, line_value, outcome_name, over_price,
                outcome, composite_grade, model_version, sample_size_60, sport
            ) VALUES (
                s.grade_date, s.event_id, s.game_id, s.player_id, s.player_name,
                s.market_key, s.bookmaker_key, s.line_value, s.outcome_name, s.over_price,
                s.outcome, s.composite_grade, s.model_version, s.sample_size_60, s.sport
            );
        """)
        )
    log.info("Upserted %d daily_grades rows.", len(rows))


def upsert_tier_lines(engine, rows: list[dict]):
    if not rows:
        return
    with engine.begin() as conn:
        conn.execute(
            text("""
            IF OBJECT_ID('tempdb..#stage_tiers') IS NOT NULL DROP TABLE #stage_tiers;
            CREATE TABLE #stage_tiers (
                grade_date        DATE,
                game_id           VARCHAR(50),
                player_id         BIGINT,
                player_name       NVARCHAR(100),
                market_key        VARCHAR(100),
                composite_grade   FLOAT,
                kde_window        INT,
                blowout_dampened  BIT,
                safe_line         DECIMAL(6,1), safe_prob FLOAT, safe_price INT,
                value_line        DECIMAL(6,1), value_prob FLOAT, value_price INT,
                highrisk_line     DECIMAL(6,1), highrisk_prob FLOAT, highrisk_price INT,
                lotto_line        DECIMAL(6,1), lotto_prob FLOAT, lotto_price INT,
                model_version     VARCHAR(50),
                sport             VARCHAR(10)
            );
        """)
        )
        batch = [
            (
                r["grade_date"],
                r.get("game_id"),
                r["player_id"],
                r["player_name"],
                r["market_key"],
                r["composite_grade"],
                r.get("kde_window"),
                r.get("blowout_dampened", 0),  # always False for MLB grading
                r.get("safe_line"),
                r.get("safe_prob"),
                r.get("safe_price"),
                r.get("value_line"),
                r.get("value_prob"),
                r.get("value_price"),
                r.get("highrisk_line"),
                r.get("highrisk_prob"),
                r.get("highrisk_price"),
                r.get("lotto_line"),
                r.get("lotto_prob"),
                r.get("lotto_price"),
                MODEL_VERSION,
                "mlb",
            )
            for r in rows
        ]
        conn.exec_driver_sql("INSERT INTO #stage_tiers VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", batch)
        conn.execute(
            text("""
            MERGE common.player_tier_lines AS t
            USING #stage_tiers AS s
            ON t.player_id = s.player_id
               AND t.game_id = s.game_id
               AND t.market_key = s.market_key
            WHEN MATCHED THEN UPDATE SET
                t.composite_grade = s.composite_grade,
                t.kde_window      = s.kde_window,
                t.safe_line       = s.safe_line, t.safe_prob  = s.safe_prob, t.safe_price = s.safe_price,
                t.value_line      = s.value_line, t.value_prob = s.value_prob, t.value_price = s.value_price,
                t.highrisk_line   = s.highrisk_line, t.highrisk_prob = s.highrisk_prob, t.highrisk_price = s.highrisk_price,
                t.lotto_line      = s.lotto_line, t.lotto_prob = s.lotto_prob, t.lotto_price = s.lotto_price,
                t.model_version   = s.model_version,
                t.sport           = s.sport
            WHEN NOT MATCHED THEN INSERT (
                grade_date, game_id, player_id, player_name, market_key,
                composite_grade, kde_window, blowout_dampened,
                safe_line, safe_prob, safe_price,
                value_line, value_prob, value_price,
                highrisk_line, highrisk_prob, highrisk_price,
                lotto_line, lotto_prob, lotto_price,
                model_version, sport
            ) VALUES (
                s.grade_date, s.game_id, s.player_id, s.player_name, s.market_key,
                s.composite_grade, s.kde_window, s.blowout_dampened,
                s.safe_line, s.safe_prob, s.safe_price,
                s.value_line, s.value_prob, s.value_price,
                s.highrisk_line, s.highrisk_prob, s.highrisk_price,
                s.lotto_line, s.lotto_prob, s.lotto_price,
                s.model_version, s.sport
            );
        """)
        )
    log.info("Upserted %d player_tier_lines rows.", len(rows))


# ---------------------------------------------------------------------------
# Main grading loop
# ---------------------------------------------------------------------------


def grade_date(engine, grade_date_str: str, batch_size: int, force: bool):
    log.info("=== MLB grading for %s ===", grade_date_str)

    props = fetch_upcoming_mlb_props(engine, grade_date_str)
    if props.empty:
        # Zero props on a day with scheduled MLB games means the odds feed is
        # broken (dead API key, dead workflow), not that there is nothing to
        # grade. Exiting 0 here hid a two-month outage (no mlb-v1.0 rows
        # after 2026-05-01 while the workflow stayed green). Fail loudly.
        scheduled = pd.read_sql(
            text("SELECT COUNT(*) AS n FROM mlb.games WHERE CAST(game_date AS DATE) = :d"),
            engine,
            params={"d": grade_date_str},
        ).iloc[0]["n"]
        if int(scheduled) > 0:
            # mlb.games.game_date is the ET schedule date while props filter
            # on CAST(commence_time AS DATE) (UTC) - a West-coast-heavy slate
            # can legitimately land its props on grade_date+1. Only declare
            # the feed dead when there are no *fresh* MLB props at all.
            fresh = pd.read_sql(
                text("""
                SELECT COUNT(*) AS n
                FROM odds.upcoming_player_props pp
                WHERE pp.sport_key = 'baseball_mlb'
                  AND pp.created_at >= DATEADD(hour, -36, GETUTCDATE())
            """),
                engine,
            ).iloc[0]["n"]
            if int(fresh) == 0:
                log.error(
                    "No upcoming MLB props for %s, %d games scheduled, and no "
                    "MLB props ingested in the last 36h. The odds pipeline is "
                    "stale (check ODDS_API_KEY / odds-etl.yml). Failing so this "
                    "cannot pass as a green run.",
                    grade_date_str,
                    int(scheduled),
                )
                raise SystemExit(2)
            log.warning(
                "No props matched %s but %d fresh MLB props exist (UTC/ET "
                "date shift?). Skipping without failing; check the date "
                "conventions if this repeats.",
                grade_date_str,
                int(fresh),
            )
        log.info("No upcoming MLB props and no scheduled games for %s (offseason/off-day). Exiting.", grade_date_str)
        return

    # Resolve player IDs — Over side only (we'll flip for Under)
    over_props = props[props["outcome_name"] == "Over"].copy()
    player_ids = [int(p) for p in over_props["player_id"].dropna().unique()]
    game_pks = [int(g) for g in over_props["game_pk"].dropna().unique()]

    trend_map = {}
    if player_ids:
        ts_df = fetch_trend_stats(engine, player_ids, grade_date_str)
        trend_map = {int(r["batter_id"]): r for _, r in ts_df.iterrows()}

    # Collect unique pitcher IDs from games
    pitcher_ids_set = set()
    game_pitcher_map = {}  # game_pk -> {away_pitcher_id, home_pitcher_id, ...}
    if game_pks:
        gp_list = ", ".join(str(g) for g in game_pks)
        game_info_df = pd.read_sql(
            text(f"""
            SELECT game_pk, away_team_id, home_team_id,
                   away_pitcher_id, away_pitcher_hand,
                   home_pitcher_id, home_pitcher_hand
            FROM mlb.games
            WHERE game_pk IN ({gp_list})
        """),
            engine,
        )
        for _, row in game_info_df.iterrows():
            gp = int(row["game_pk"])
            game_pitcher_map[gp] = {
                "away_pitcher_id": row["away_pitcher_id"],
                "away_pitcher_hand": row["away_pitcher_hand"],
                "home_pitcher_id": row["home_pitcher_id"],
                "home_pitcher_hand": row["home_pitcher_hand"],
                "away_team_id": row["away_team_id"],
                "home_team_id": row["home_team_id"],
            }
            if row["away_pitcher_id"]:
                pitcher_ids_set.add(int(row["away_pitcher_id"]))
            if row["home_pitcher_id"]:
                pitcher_ids_set.add(int(row["home_pitcher_id"]))

    pitcher_stats_map = {}
    if pitcher_ids_set:
        ps_df = fetch_pitcher_season_stats(engine, list(pitcher_ids_set))
        pitcher_stats_map = {int(r["pitcher_id"]): r for _, r in ps_df.iterrows()}

    # Build BvP lookup for batter props
    batter_matchups = []
    for _, row in over_props.iterrows():
        row_cfg = MARKET_CONFIG.get(row["market_key"])
        if row_cfg is None or row_cfg["family"] == "pitcher":
            continue
        pid = row["player_id"]
        gp = row["game_pk"]
        if pd.isna(pid) or pd.isna(gp):
            continue
        ginfo = game_pitcher_map.get(int(gp), {})
        # Determine which team batter is on; opposing SP is the other side's pitcher
        # We infer from batting_stats.side when available; fall back to using both SPs
        batter_matchups.append((int(pid), ginfo.get("away_pitcher_id")))
        batter_matchups.append((int(pid), ginfo.get("home_pitcher_id")))

    batter_matchups = [(b, p) for b, p in batter_matchups if b and p]
    bvp_df = fetch_bvp_for_games(engine, batter_matchups)
    bvp_map = {}
    for _, row in bvp_df.iterrows():
        bvp_map[(int(row["batter_id"]), int(row["pitcher_id"]))] = row

    # Sport-scoped calibrator (weekly_calibration.py is the only writer).
    # Identity/absent -> raw KDE probabilities, the pre-v2 behavior.
    calibrator = None
    try:
        _cal = load_calibrator(engine, "mlb")
        if _cal["method"] != "identity":

            def calibrator(p):  # noqa: E731 — mirrors NBA's callable shape
                return float(apply_calibrator(_cal, float(p)))

        log.info("Calibrator loaded for mlb: method=%s", _cal["method"])
    except Exception as exc:
        log.info("Calibrator load skipped (%s); using raw probabilities.", exc)

    grade_rows = []
    tier_rows = []
    processed = 0

    for (event_id, market_key), group in over_props.groupby(["event_id", "market_key"]):
        if processed >= batch_size:
            break

        for _, prop_row in group.iterrows():
            player_id = prop_row.get("player_id")
            player_name = prop_row["player_name"]
            line_value = prop_row["line_value"]
            over_price = prop_row["outcome_price"]
            game_pk = prop_row.get("game_pk")

            if pd.isna(player_id):
                log.debug("Skipping %s %s — no player_id.", player_name, market_key)
                continue

            player_id = int(player_id)
            _game_pk_valid = game_pk is not None and not pd.isna(game_pk)
            ginfo = game_pitcher_map.get(int(game_pk) if _game_pk_valid else 0, {})

            # Determine opposing pitcher for this batter
            # We need to know which team the batter is on.
            # Use batting_stats.side for today's game if available;
            # fall back to checking which SP they're more likely to face
            # based on career BvP recency.
            opp_pitcher_id = None
            opp_pitcher_hand = None

            cfg = MARKET_CONFIG.get(market_key)
            if cfg is None:
                log.debug("Skipping %s — market %s not in MARKET_CONFIG.", player_name, market_key)
                continue
            family = cfg["family"]

            if family != "pitcher":
                # Check both sides; use the one with more recent BvP or just away SP
                away_sp = ginfo.get("away_pitcher_id")
                home_sp = ginfo.get("home_pitcher_id")
                # Away batter faces home SP; home batter faces away SP
                # We can't tell from props alone which team the batter is on.
                # Use player_season_batting.team_id vs game teams to resolve.
                batter_team_df = pd.read_sql(
                    text("""
                    SELECT team_id FROM mlb.player_season_batting
                    WHERE player_id = :pid ORDER BY season_year DESC
                """),
                    engine,
                    params={"pid": player_id},
                )
                if not batter_team_df.empty:
                    batter_team = int(batter_team_df["team_id"].iloc[0])
                    away_team = ginfo.get("away_team_id")
                    home_team = ginfo.get("home_team_id")
                    if batter_team == away_team:
                        # Batter is away team, faces home SP
                        opp_pitcher_id = home_sp
                        opp_pitcher_hand = ginfo.get("home_pitcher_hand")
                    elif batter_team == home_team:
                        opp_pitcher_id = away_sp
                        opp_pitcher_hand = ginfo.get("away_pitcher_hand")

            # Fetch grade inputs
            ts = trend_map.get(player_id, pd.Series(dtype=float))
            pitcher_stats = pitcher_stats_map.get(opp_pitcher_id) if opp_pitcher_id else None
            bvp = bvp_map.get((player_id, int(opp_pitcher_id))) if opp_pitcher_id else None

            # Game log once per prop: recent form for the composite AND the
            # KDE tier fit below (previously fetched twice for pitchers).
            game_log = fetch_game_log(engine, player_id, market_key, grade_date_str)

            # Compute grade by market family
            if family == "pitcher":
                opp_rate = None
                if _game_pk_valid:
                    # pitcher is away or home — determine from pitcher map
                    ap_id = ginfo.get("away_pitcher_id")
                    is_home = ap_id != player_id
                    opp_rate = fetch_opposing_lineup_rate(
                        engine,
                        int(game_pk),
                        is_home,
                        grade_date_str,
                        rate_col=cfg["opp_rate_col"],
                    )
                ps = pitcher_stats_map.get(player_id)
                composite = compute_pitcher_market_grade(cfg, ps, game_log, opp_rate)
            elif family == "batter_count":
                form_grade = compute_game_avg_grade(game_log, cfg)
                ev_grade = compute_ev_grade(ts)
                matchup_grade = compute_batter_matchup_grade(pitcher_stats, bvp, ts, market_key, opp_pitcher_hand)
                composite = compute_composite(
                    form_grade,
                    ev_grade,
                    matchup_grade,
                    no_ev=market_key in ("batter_walks", "batter_strikeouts", "batter_stolen_bases"),
                )
            else:  # batter_rate — hits / total bases / home runs
                hit_grade = compute_hit_rate_grade(ts, market_key)
                ev_grade = compute_ev_grade(ts)
                matchup_grade = compute_batter_matchup_grade(pitcher_stats, bvp, ts, market_key, opp_pitcher_hand)
                composite = compute_composite(hit_grade, ev_grade, matchup_grade)

            # KDE tier lines
            tiers = compute_kde_tier_lines(game_log, composite, market_key, calibrator=calibrator)

            kde_window = KDE_WINDOW_HOT if composite >= 80 else KDE_WINDOW_MID if composite >= 50 else KDE_WINDOW_COLD

            # Write daily_grades row for the standard line (Over)
            grade_rows.append(
                {
                    "grade_date": grade_date_str,
                    "event_id": str(event_id),
                    "game_id": str(int(game_pk)) if _game_pk_valid else None,
                    "player_id": player_id,
                    "player_name": player_name,
                    "market_key": market_key,
                    "bookmaker_key": BOOKMAKER,
                    "line_value": float(line_value),
                    "outcome_name": "Over",
                    "over_price": int(over_price) if not pd.isna(over_price) else None,
                    "outcome": None,
                    "composite_grade": round(composite, 2),
                    # Layer 1 always_required (shared/integrity.py). The MLB
                    # analog of the NBA 60-game window sample: games in the
                    # market's game log. Omitting it quarantined every MLB
                    # grade row (3,480 rows) whenever grading got past the
                    # odds gate.
                    "sample_size_60": int(len(game_log)),
                }
            )

            # Tier lines row
            tier_row = {
                "grade_date": grade_date_str,
                "game_id": str(int(game_pk)) if _game_pk_valid else None,
                "player_id": player_id,
                "player_name": player_name,
                "market_key": market_key,
                "composite_grade": round(composite, 2),
                "kde_window": kde_window,
                # Layer 1 always_required; MLB never blowout-dampens.
                "blowout_dampened": 0,
            }
            for tier_label in ("safe", "value", "highrisk", "lotto"):
                t = tiers.get(tier_label)
                if t:
                    line, prob = t
                    price = implied_to_american(prob)
                    tier_row[f"{tier_label}_line"] = line
                    tier_row[f"{tier_label}_prob"] = round(prob, 4)
                    tier_row[f"{tier_label}_price"] = price
            tier_rows.append(tier_row)

            processed += 1

    grade_rows = validate_and_filter(grade_rows, "common.daily_grades", engine, "mlb-grading.yml")
    tier_rows = validate_and_filter(tier_rows, "common.player_tier_lines", engine, "mlb-grading.yml")
    upsert_daily_grades(engine, grade_rows)
    upsert_tier_lines(engine, tier_rows)
    log.info("Grading complete: %d players graded.", processed)


# ---------------------------------------------------------------------------
# Outcome settlement
# ---------------------------------------------------------------------------

# market_key -> (source table alias, trusted SQL stat expression). Config-only,
# never user input — same trust model as MARKET_CONFIG["expr"]. Batter stats
# come from the deduped mlb.batting_stats row (max plate_appearances per
# (game_pk, player_id): batter_game_id embeds team_id, so a (game, player)
# can carry two rows — same dedup the props board uses).
OUTCOME_STAT_EXPRS = {
    "batter_hits": "b.hits",
    "batter_total_bases": "b.total_bases",
    "batter_home_runs": "b.home_runs",
    "batter_rbis": "b.rbi",
    "batter_runs_scored": "b.runs",
    "batter_hits_runs_rbis": "(b.hits + b.runs + b.rbi)",
    "batter_singles": "(b.hits - b.doubles - b.triples - b.home_runs)",
    "batter_doubles": "b.doubles",
    "batter_triples": "b.triples",
    "batter_walks": "b.walks",
    "batter_strikeouts": "b.strikeouts",
    "batter_stolen_bases": "b.stolen_bases",
}
OUTCOME_PITCHER_EXPRS = {
    "pitcher_strikeouts": "p.strikeouts",
    "pitcher_hits_allowed": "p.hits_allowed",
    "pitcher_walks": "p.walks",
    "pitcher_earned_runs": "p.earned_runs",
}

_MLB_MARKET_LIST = ", ".join(f"'{k}'" for k in list(OUTCOME_STAT_EXPRS) + list(OUTCOME_PITCHER_EXPRS))

_OUTCOME_CASE = """CASE
                WHEN actual.stat_val = dg.line_value THEN 'Push'
                WHEN dg.outcome_name = 'Over'  AND actual.stat_val > dg.line_value THEN 'Won'
                WHEN dg.outcome_name = 'Over'  AND actual.stat_val < dg.line_value THEN 'Lost'
                WHEN dg.outcome_name = 'Under' AND actual.stat_val < dg.line_value THEN 'Won'
                WHEN dg.outcome_name = 'Under' AND actual.stat_val > dg.line_value THEN 'Lost'
                ELSE NULL
            END"""

_BATTER_ACTUAL = """(
                SELECT game_pk, player_id, stat_val FROM (
                    SELECT b.game_pk, b.player_id, {expr} AS stat_val,
                           ROW_NUMBER() OVER (PARTITION BY b.game_pk, b.player_id
                                              ORDER BY b.plate_appearances DESC) AS rn
                    FROM mlb.batting_stats b
                ) d WHERE d.rn = 1
            )"""

_PITCHER_ACTUAL = """(
                SELECT p.game_pk, p.player_id, {expr} AS stat_val
                FROM mlb.pitching_stats p
            )"""


def run_outcomes(engine, specific_date: str | None = None) -> int:
    """Settle NULL-outcome MLB grade rows against final boxscores.

    Won/Lost/Push from the realized stat; DNP when the game is final and the
    player never appeared. Rows whose game_id is NULL settle via a
    grade_date match when the player has exactly ONE boxscore row that date
    (a doubleheader is ambiguous — left NULL and logged).
    """
    date_clause = "AND dg.grade_date = :gd" if specific_date else ""
    params: dict = {"gd": specific_date} if specific_date else {}
    total = 0

    # Short-circuit: the settlement scans (windowed dedup over the full
    # boxscore tables, per market) are expensive — run them only for markets
    # that actually have pending rows, and Pass B only when NULL-game_id
    # pending rows exist.
    pending_df = pd.read_sql(
        text(f"""
            SELECT dg.market_key,
                   SUM(CASE WHEN dg.game_id IS NULL THEN 1 ELSE 0 END) AS n_null_game,
                   COUNT(*) AS n_pending
            FROM common.daily_grades dg
            WHERE dg.outcome IS NULL
              AND dg.player_id IS NOT NULL
              AND dg.market_key IN ({_MLB_MARKET_LIST})
              {date_clause}
            GROUP BY dg.market_key
        """),
        engine,
        params=params,
    )
    pending = {r["market_key"]: (int(r["n_pending"]), int(r["n_null_game"])) for _, r in pending_df.iterrows()}
    if not pending:
        log.info("Outcomes: no pending MLB rows to settle.")
        return 0

    for market_key, expr in {**OUTCOME_STAT_EXPRS, **OUTCOME_PITCHER_EXPRS}.items():
        n_pending, n_null_game = pending.get(market_key, (0, 0))
        if n_pending == 0:
            continue
        actual_tpl = _PITCHER_ACTUAL if market_key in OUTCOME_PITCHER_EXPRS else _BATTER_ACTUAL
        actual_sql = actual_tpl.format(expr=expr)

        # Pass A: rows that carry a game_pk in game_id.
        sql_a = text(f"""
            UPDATE dg
            SET dg.outcome = {_OUTCOME_CASE}
            FROM common.daily_grades dg
            JOIN mlb.games g
              ON g.game_pk = TRY_CAST(dg.game_id AS BIGINT) AND g.game_status = 'F'
            JOIN {actual_sql} actual
              ON actual.game_pk = g.game_pk AND actual.player_id = dg.player_id
            WHERE dg.outcome IS NULL
              AND dg.player_id IS NOT NULL
              AND dg.market_key = '{market_key}'
              {date_clause}
        """)
        # Pass B: NULL game_id — settle by date when unambiguous (one final
        # game row for the player that day).
        src = "mlb.pitching_stats" if market_key in OUTCOME_PITCHER_EXPRS else "mlb.batting_stats"
        alias = "p" if market_key in OUTCOME_PITCHER_EXPRS else "b"
        # Pass A dedups batter duplicates by max plate_appearances; pitcher rows
        # have no PA column — innings_pitched is the analogous "primary row" key.
        order_col = f"{alias}.innings_pitched" if alias == "p" else f"{alias}.plate_appearances"
        sql_b = text(f"""
            UPDATE dg
            SET dg.outcome = {_OUTCOME_CASE}
            FROM common.daily_grades dg
            JOIN (
                SELECT x.player_id, x.d, x.stat_val
                FROM (
                    SELECT {alias}.player_id, CAST({alias}.game_date AS DATE) AS d,
                           {expr} AS stat_val,
                           ROW_NUMBER() OVER (PARTITION BY {alias}.player_id, CAST({alias}.game_date AS DATE)
                                              ORDER BY {order_col} DESC) AS rn,
                           MIN({alias}.game_pk) OVER (PARTITION BY {alias}.player_id, CAST({alias}.game_date AS DATE)) AS min_pk,
                           MAX({alias}.game_pk) OVER (PARTITION BY {alias}.player_id, CAST({alias}.game_date AS DATE)) AS max_pk
                    FROM {src} {alias}
                    JOIN mlb.games g ON g.game_pk = {alias}.game_pk AND g.game_status = 'F'
                ) x
                -- rn=1 = the max-PA row, matching Pass A's dedup; min_pk=max_pk
                -- = exactly one final game that date (doubleheaders stay NULL).
                WHERE x.rn = 1 AND x.min_pk = x.max_pk
            ) actual
              ON actual.player_id = dg.player_id
             AND actual.d = dg.grade_date
            WHERE dg.outcome IS NULL
              AND dg.game_id IS NULL
              AND dg.player_id IS NOT NULL
              AND dg.market_key = '{market_key}'
              {date_clause}
        """)
        with engine.begin() as conn:
            n = conn.execute(sql_a, params).rowcount
            if n_null_game:
                n += conn.execute(sql_b, params).rowcount
        if n:
            log.info("  %s: %d rows settled.", market_key, n)
            total += n

    # DNP: the row's game is final but the player has no boxscore row of the
    # market's kind. game_id-present rows only — a NULL game_id can't prove
    # absence for a specific game.
    for kind, src in (("batter", "mlb.batting_stats"), ("pitcher", "mlb.pitching_stats")):
        keys = OUTCOME_PITCHER_EXPRS if kind == "pitcher" else OUTCOME_STAT_EXPRS
        mkt_list = ", ".join(f"'{k}'" for k in keys)
        dnp_sql = text(f"""
            UPDATE dg
            SET dg.outcome = 'DNP'
            FROM common.daily_grades dg
            JOIN mlb.games g
              ON g.game_pk = TRY_CAST(dg.game_id AS BIGINT) AND g.game_status = 'F'
            WHERE dg.outcome IS NULL
              AND dg.player_id IS NOT NULL
              AND dg.market_key IN ({mkt_list})
              AND NOT EXISTS (
                  SELECT 1 FROM {src} s
                  WHERE s.player_id = dg.player_id AND s.game_pk = g.game_pk
              )
              {date_clause}
        """)
        with engine.begin() as conn:
            n_dnp = conn.execute(dnp_sql, params).rowcount
        if n_dnp:
            log.info("  DNP (%s): %d rows.", kind, n_dnp)
            total += n_dnp

    pending = pd.read_sql(
        text(f"""SELECT COUNT(*) AS n FROM common.daily_grades dg
                 WHERE dg.outcome IS NULL AND dg.market_key IN ({_MLB_MARKET_LIST})
                 {date_clause}"""),
        engine,
        params=params,
    ).iloc[0]["n"]
    log.info("Outcomes: %d rows settled; %d still pending (future or ambiguous).", total, int(pending))
    return total


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=["upcoming", "outcomes"], default="upcoming")
    parser.add_argument("--date", default=None, help="Grade date YYYY-MM-DD (default: today CT)")
    parser.add_argument("--batch", type=int, default=BATCH_DEFAULT)
    parser.add_argument("--force", action="store_true", help="Re-grade even if already graded today")
    args = parser.parse_args()

    engine = get_engine()
    ensure_schema(engine)
    ensure_integrity_tables(engine)
    if args.mode == "outcomes":
        run_outcomes(engine, specific_date=args.date)
    else:
        grade_date_str = args.date or today_ct()
        grade_date(engine, grade_date_str, args.batch, args.force)
    log.info("=== MLB grading complete ===")


if __name__ == "__main__":
    main()
