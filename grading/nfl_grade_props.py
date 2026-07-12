"""
nfl_grade_props.py — NFL prop grading model (nfl-v1.0).

Mirrors the MLB grading shape (MARKET_CONFIG-driven families, KDE tier
lines, composite grade, Won/Lost/Push/DNP settlement) over nflreadpy data:

  nfl.player_game_stats  — weekly per-player stats (the game log + outcomes)
  nfl.snap_counts        — offense snap share (volume stability)
  nfl.games              — schedule/results (finality gate; game_id join key)
  nfl.players            — identity (gsis_id)

Identity: common.daily_grades.player_id is BIGINT; NFL players are keyed by
gsis_id ('00-0033873'). We store the numeric suffix as player_id
(int('0033873') -> 33873) and reconstruct gsis with f"00-{pid:07d}".
resolve-mappings.yml emits the same encoding.

Composite (batter-family analog):
  form    0.40 — weighted recent per-game stat (L4 0.5 / L8 0.3 / season 0.2),
                 normalized against per-market ceilings
  matchup 0.35 — opponent's season-to-date allowed-per-game to the player's
                 position group, normalized against the league mean
  volume  0.25 — L4 offense snap share minus a variance penalty

Tier lines: same KDE machinery and tier thresholds as NBA/MLB; windows are
8 / 12 / 17 games (a season is 17 — NBA's 15/30/60 shrunk proportionally).
Tier probabilities pass through the sport='nfl' calibrator from
common.grade_calibration when one is active.

Modes:
  --mode upcoming  (default) grade today's posted FanDuel props
  --mode outcomes  settle NULL-outcome rows against final boxscores

Pipeline-truth: zero posted props while NFL games are scheduled within the
next 3 days AND fresh NFL props exist in the odds table = hard fail;
offseason/no-games = clean exit.
"""

import argparse
import logging
import sys
from datetime import datetime, timezone

import numpy as np
import pandas as pd
from scipy.stats import gaussian_kde
from sqlalchemy import text

from shared.integrity import validate_and_filter, ensure_tables as ensure_integrity_tables
from grading.calibration_core import load_calibrator, apply_calibrator

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger(__name__)

MODEL_VERSION = "nfl-v1.0"
BOOKMAKER = "fanduel"
BATCH_DEFAULT = 200

# KDE parameters — season length 17, so windows shrink vs NBA's 15/30/60.
KDE_WINDOW_HOT = 8
KDE_WINDOW_MID = 12
KDE_WINDOW_COLD = 17
KDE_MIN_GAMES = 4
KDE_THIN_SAMPLE_PROB_CAP = 0.85

TIER_SAFE_PROB = 0.80
TIER_VALUE_PROB = 0.58
TIER_HIGHRISK_PROB = 0.28
TIER_LOTTO_PROB = 0.07

# Composite weights
W_FORM = 0.40
W_MATCHUP = 0.35
W_VOLUME = 0.25

# Line-scan step. Yardage markets move in whole yards on the tier ladder;
# count markets in 0.5s.
YARDS_STEP = 1.0
COUNT_STEP = 0.5

# Market config. "expr" is a trusted SQL expression over nfl.player_game_stats
# (config-only, never user input). positions = the position group whose
# opponent-allowed rate defines the matchup grade. ceil/floor normalize the
# per-game form value to 0-100 (empirical strong-player ranges, 2022-2025).
MARKET_CONFIG = {
    "player_pass_yds": {
        "family": "qb",
        "expr": "passing_yards",
        "positions": ("QB",),
        "ceil": 320.0,
        "floor": 140.0,
        "step": YARDS_STEP,
    },
    "player_pass_tds": {
        "family": "qb",
        "expr": "passing_tds",
        "positions": ("QB",),
        "ceil": 2.8,
        "floor": 0.5,
        "step": COUNT_STEP,
    },
    "player_pass_attempts": {
        "family": "qb",
        "expr": "attempts",
        "positions": ("QB",),
        "ceil": 42.0,
        "floor": 22.0,
        "step": YARDS_STEP,
    },
    "player_pass_completions": {
        "family": "qb",
        "expr": "completions",
        "positions": ("QB",),
        "ceil": 28.0,
        "floor": 14.0,
        "step": YARDS_STEP,
    },
    "player_rush_yds": {
        "family": "rush",
        "expr": "rushing_yards",
        "positions": ("RB", "QB"),
        "ceil": 110.0,
        "floor": 20.0,
        "step": YARDS_STEP,
    },
    "player_rush_attempts": {
        "family": "rush",
        "expr": "carries",
        "positions": ("RB",),
        "ceil": 24.0,
        "floor": 6.0,
        "step": COUNT_STEP,
    },
    "player_receptions": {
        "family": "receiving",
        "expr": "receptions",
        "positions": ("WR", "TE", "RB"),
        "ceil": 8.5,
        "floor": 2.0,
        "step": COUNT_STEP,
    },
    "player_reception_yds": {
        "family": "receiving",
        "expr": "receiving_yards",
        "positions": ("WR", "TE", "RB"),
        "ceil": 105.0,
        "floor": 20.0,
        "step": YARDS_STEP,
    },
}


# ---------------------------------------------------------------------------
# Identity helpers
# ---------------------------------------------------------------------------


def gsis_to_player_id(gsis: str):
    """'00-0033873' -> 33873. Returns None on malformed ids."""
    try:
        return int(gsis.replace("-", ""))
    except (AttributeError, ValueError):
        return None


def player_id_to_gsis(pid: int) -> str:
    return f"00-{int(pid):07d}"


# ---------------------------------------------------------------------------
# DB
# ---------------------------------------------------------------------------


# Grading connections need fast_executemany=False (NVARCHAR truncation rule);
# shared.db.get_engine_slow is exactly that — no local engine factory.
from shared.db import get_engine_slow as get_engine  # noqa: E402


def today_utc_date() -> str:
    return datetime.now(timezone.utc).date().isoformat()


# ---------------------------------------------------------------------------
# Fetchers
# ---------------------------------------------------------------------------


def fetch_upcoming_nfl_props(engine, grade_date_str: str) -> pd.DataFrame:
    """Posted FanDuel NFL props commencing on grade_date (UTC)."""
    mkts = ", ".join(f"'{k}'" for k in MARKET_CONFIG)
    sql = text(f"""
        SELECT pp.event_id, pp.player_id, pp.player_name, pp.market_key,
               pp.outcome_name, pp.outcome_point AS line_value,
               pp.outcome_price, ue.home_team, ue.away_team, ue.commence_time
        FROM odds.upcoming_player_props pp
        JOIN odds.upcoming_events ue ON ue.event_id = pp.event_id
        WHERE pp.sport_key = 'americanfootball_nfl'
          AND pp.bookmaker_key = :bk
          AND pp.market_key IN ({mkts})
          AND pp.outcome_name IN ('Over', 'Under')
          AND CAST(ue.commence_time AS DATE) = :d
    """)
    return pd.read_sql(sql, engine, params={"bk": BOOKMAKER, "d": grade_date_str})


def fetch_game_log(engine, gsis: str, expr: str, before_season: int, before_week: int) -> pd.DataFrame:
    """Per-game stat values strictly before (season, week), most recent first.

    Includes REG and POST rows: nflverse week numbers are globally unique
    within a season (REG 1-18, POST 19-22; verified on the live DB), so
    (season, week) ordering and joins are unambiguous without season_type.
    """
    sql = text(f"""
        SELECT season, week, opponent_team, {expr} AS stat_value
        FROM nfl.player_game_stats
        WHERE player_gsis_id = :g
          AND ({expr}) IS NOT NULL
          AND (season < :s OR (season = :s AND week < :w))
        ORDER BY season DESC, week DESC
    """)
    df = pd.read_sql(sql, engine, params={"g": gsis, "s": before_season, "w": before_week})
    return df


def fetch_snap_share(engine, gsis: str, before_season: int, before_week: int) -> pd.Series:
    """L4 offense snap share for the player, most recent first.

    snap_counts is keyed by pfr id, not gsis — join through player_name via
    nfl.players (display_name). Best effort: empty series when unmatched.
    """
    sql = text("""
        SELECT sc.offense_pct
        FROM nfl.snap_counts sc
        JOIN nfl.players p
          ON p.display_name = sc.player_name AND p.gsis_id = :g
        WHERE (sc.season < :s OR (sc.season = :s AND sc.week < :w))
        ORDER BY sc.season DESC, sc.week DESC
    """)
    df = pd.read_sql(sql, engine, params={"g": gsis, "s": before_season, "w": before_week})
    return pd.to_numeric(df["offense_pct"], errors="coerce").dropna().head(4)


def fetch_opponent_allowed(
    engine, opponent: str, positions: tuple, expr: str, season: int, before_week: int
) -> float | None:
    """Opponent's allowed-per-game of this stat to the position group,
    season-to-date (strictly before the target week)."""
    pos_list = ", ".join(f"'{p}'" for p in positions)
    sql = text(f"""
        SELECT SUM(CAST({expr} AS FLOAT)) AS total, COUNT(DISTINCT week) AS games
        FROM nfl.player_game_stats
        WHERE opponent_team = :opp AND season = :s AND week < :w
          AND position IN ({pos_list})
    """)
    row = pd.read_sql(sql, engine, params={"opp": opponent, "s": season, "w": before_week}).iloc[0]
    if row["games"] and row["games"] > 0 and row["total"] is not None:
        return float(row["total"]) / float(row["games"])
    return None


def fetch_league_allowed(engine, positions: tuple, expr: str, season: int, before_week: int) -> float | None:
    """League-average allowed-per-team-game to the position group."""
    pos_list = ", ".join(f"'{p}'" for p in positions)
    sql = text(f"""
        SELECT SUM(CAST({expr} AS FLOAT)) AS total,
               COUNT(DISTINCT CONCAT(opponent_team, '-', week)) AS team_games
        FROM nfl.player_game_stats
        WHERE season = :s AND week < :w AND position IN ({pos_list})
    """)
    row = pd.read_sql(sql, engine, params={"s": season, "w": before_week}).iloc[0]
    if row["team_games"] and row["team_games"] > 0 and row["total"] is not None:
        return float(row["total"]) / float(row["team_games"])
    return None


# ---------------------------------------------------------------------------
# Grade components
# ---------------------------------------------------------------------------


def clamp(v, lo=0.0, hi=100.0):
    return max(lo, min(hi, v))


def normalize(val, ceiling, floor=0.0) -> float:
    if ceiling <= floor:
        return 50.0
    return clamp((float(val) - floor) / (ceiling - floor) * 100.0)


def compute_form_grade(game_log: pd.DataFrame, cfg: dict) -> float:
    """Weighted recent per-game average: L4 0.5 / L8 0.3 / season 0.2."""
    vals = pd.to_numeric(game_log["stat_value"], errors="coerce").dropna()
    if vals.empty:
        return 50.0
    l4 = vals.head(4).mean()
    l8 = vals.head(8).mean()
    season = vals.head(17).mean()
    blended = 0.5 * l4 + 0.3 * l8 + 0.2 * season
    return normalize(blended, cfg["ceil"], cfg["floor"])


def compute_matchup_grade(opp_allowed: float | None, league_allowed: float | None) -> float:
    """Opponent generosity vs league mean, mapped so league-average = 50."""
    if opp_allowed is None or league_allowed is None or league_allowed <= 0:
        return 50.0
    ratio = opp_allowed / league_allowed  # >1 = soft defense = Over-friendly
    return clamp(50.0 + (ratio - 1.0) * 100.0)


def compute_volume_grade(snap_shares: pd.Series) -> float:
    """L4 snap share level, penalized by its volatility."""
    if snap_shares is None or len(snap_shares) == 0:
        return 50.0
    mean = float(snap_shares.mean())
    std = float(snap_shares.std()) if len(snap_shares) > 1 else 0.0
    # offense_pct is 0-100 in snap_counts; already a natural 0-100 grade.
    return clamp(mean - std)


def compute_composite(form: float, matchup: float, volume: float) -> float:
    return clamp(W_FORM * form + W_MATCHUP * matchup + W_VOLUME * volume)


# ---------------------------------------------------------------------------
# KDE tier lines (shared shape with NBA/MLB)
# ---------------------------------------------------------------------------


def american_to_implied(price: int) -> float:
    p = int(price)
    return 100.0 / (p + 100.0) if p >= 0 else abs(p) / (abs(p) + 100.0)


def implied_to_american(prob: float) -> int:
    p = min(max(float(prob), 1e-4), 1 - 1e-4)
    if p >= 0.5:
        return int(round(-100.0 * p / (1.0 - p)))
    return int(round(100.0 * (1.0 - p) / p))


def compute_kde_tier_lines(game_log: pd.DataFrame, composite: float, market_key: str, calibrator=None) -> dict:
    """KDE over the game log; safe/value/highrisk/lotto (line, prob) per the
    shared tier thresholds. Tier selection and stored probabilities use the
    calibrated value when a sport='nfl' calibrator is active."""
    if game_log.empty or len(game_log) < KDE_MIN_GAMES:
        return {}
    if composite >= 80:
        window = KDE_WINDOW_HOT
    elif composite >= 50:
        window = KDE_WINDOW_MID
    else:
        window = KDE_WINDOW_COLD

    values = pd.to_numeric(game_log["stat_value"].head(window), errors="coerce").dropna().values.astype(float)
    if len(values) < KDE_MIN_GAMES:
        from scipy.stats import norm

        mu, sigma = float(np.mean(values)), float(np.std(values))
        if sigma < 0.01:
            sigma = 0.5

        def prob_over(line):
            return min(1 - norm.cdf(line, loc=mu, scale=sigma), KDE_THIN_SAMPLE_PROB_CAP)
    else:
        reflected = np.concatenate([values, -values])
        try:
            kde = gaussian_kde(reflected)
        except Exception:
            return {}

        def prob_over(line):
            return min(max(float(kde.integrate_box_1d(line, np.inf) * 2), 0.0), 1.0)

    step = MARKET_CONFIG[market_key]["step"]
    results = {}
    max_line = float(max(values)) + 3 * step
    for prob_thresh, label in [
        (TIER_SAFE_PROB, "safe"),
        (TIER_VALUE_PROB, "value"),
        (TIER_HIGHRISK_PROB, "highrisk"),
        (TIER_LOTTO_PROB, "lotto"),
    ]:
        candidate = None
        line = step
        while line <= max_line:
            p = prob_over(line)
            if calibrator is not None:
                p = float(calibrator(p))
            if p >= prob_thresh:
                candidate = (line, p)
            line += step
        results[label] = candidate
    return results


# ---------------------------------------------------------------------------
# Writers (staged MERGE, mirrors mlb_grade_props)
# ---------------------------------------------------------------------------


def ensure_schema(engine):
    with engine.begin() as conn:
        for tbl in ("common.daily_grades", "common.player_tier_lines"):
            exists = conn.execute(
                text("SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA + '.' + TABLE_NAME = :t"),
                {"t": tbl},
            ).fetchone()
            if not exists:
                raise RuntimeError(f"{tbl} does not exist. Run the NBA grading setup first.")
    log.info("Schema check passed.")


def upsert_daily_grades(engine, rows: list[dict]):
    if not rows:
        return
    with engine.begin() as conn:
        conn.execute(
            text("""
            IF OBJECT_ID('tempdb..#stage_grades') IS NOT NULL DROP TABLE #stage_grades;
            CREATE TABLE #stage_grades (
                grade_date DATE, event_id VARCHAR(50), game_id VARCHAR(50),
                player_id BIGINT, player_name NVARCHAR(100), market_key VARCHAR(100),
                bookmaker_key VARCHAR(50), line_value DECIMAL(6,1), outcome_name VARCHAR(5),
                over_price INT, outcome VARCHAR(5), composite_grade FLOAT,
                model_version VARCHAR(50), sport VARCHAR(10), sample_size_60 INT
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
                "nfl",
                r.get("sample_size_60"),
            )
            for r in rows
        ]
        conn.exec_driver_sql("INSERT INTO #stage_grades VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", batch)
        conn.execute(
            text("""
            MERGE common.daily_grades AS t
            USING #stage_grades AS s
            ON t.player_id = s.player_id AND t.event_id = s.event_id
               AND t.market_key = s.market_key AND t.line_value = s.line_value
               AND t.outcome_name = s.outcome_name
            WHEN MATCHED THEN UPDATE SET
                t.composite_grade = s.composite_grade,
                t.over_price = s.over_price,
                t.model_version = s.model_version,
                t.sport = s.sport,
                t.sample_size_60 = s.sample_size_60
            WHEN NOT MATCHED THEN INSERT (
                grade_date, event_id, game_id, player_id, player_name, market_key,
                bookmaker_key, line_value, outcome_name, over_price, outcome,
                composite_grade, model_version, sport, sample_size_60
            ) VALUES (
                s.grade_date, s.event_id, s.game_id, s.player_id, s.player_name,
                s.market_key, s.bookmaker_key, s.line_value, s.outcome_name,
                s.over_price, s.outcome, s.composite_grade, s.model_version, s.sport,
                s.sample_size_60
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
                grade_date DATE, game_id VARCHAR(50), player_id BIGINT,
                player_name NVARCHAR(100), market_key VARCHAR(100),
                composite_grade FLOAT, kde_window INT, blowout_dampened BIT,
                safe_line DECIMAL(6,1), safe_prob FLOAT, safe_price INT,
                value_line DECIMAL(6,1), value_prob FLOAT, value_price INT,
                highrisk_line DECIMAL(6,1), highrisk_prob FLOAT, highrisk_price INT,
                lotto_line DECIMAL(6,1), lotto_prob FLOAT, lotto_price INT,
                model_version VARCHAR(50), sport VARCHAR(10)
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
                r.get("blowout_dampened", 0),
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
                "nfl",
            )
            for r in rows
        ]
        conn.exec_driver_sql(
            "INSERT INTO #stage_tiers VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            batch,
        )
        conn.execute(
            text("""
            MERGE common.player_tier_lines AS t
            USING #stage_tiers AS s
            ON t.player_id = s.player_id AND t.game_id = s.game_id
               AND t.market_key = s.market_key
            WHEN MATCHED THEN UPDATE SET
                t.composite_grade = s.composite_grade, t.kde_window = s.kde_window,
                t.safe_line = s.safe_line, t.safe_prob = s.safe_prob, t.safe_price = s.safe_price,
                t.value_line = s.value_line, t.value_prob = s.value_prob, t.value_price = s.value_price,
                t.highrisk_line = s.highrisk_line, t.highrisk_prob = s.highrisk_prob, t.highrisk_price = s.highrisk_price,
                t.lotto_line = s.lotto_line, t.lotto_prob = s.lotto_prob, t.lotto_price = s.lotto_price,
                t.model_version = s.model_version, t.sport = s.sport
            WHEN NOT MATCHED THEN INSERT (
                grade_date, game_id, player_id, player_name, market_key,
                composite_grade, kde_window, blowout_dampened,
                safe_line, safe_prob, safe_price, value_line, value_prob, value_price,
                highrisk_line, highrisk_prob, highrisk_price,
                lotto_line, lotto_prob, lotto_price, model_version, sport
            ) VALUES (
                s.grade_date, s.game_id, s.player_id, s.player_name, s.market_key,
                s.composite_grade, s.kde_window, s.blowout_dampened,
                s.safe_line, s.safe_prob, s.safe_price, s.value_line, s.value_prob, s.value_price,
                s.highrisk_line, s.highrisk_prob, s.highrisk_price,
                s.lotto_line, s.lotto_prob, s.lotto_price, s.model_version, s.sport
            );
        """)
        )
    log.info("Upserted %d player_tier_lines rows.", len(rows))


# ---------------------------------------------------------------------------
# Upcoming-week context
# ---------------------------------------------------------------------------


def current_season_week(engine, grade_date_str: str):
    """(season, week, game_id map by team) for games on/after grade_date.
    Returns (None, None, {}) when no NFL games are scheduled within 3 days."""
    sql = text("""
        SELECT TOP 32 game_id, season, week, game_date, home_team, away_team
        FROM nfl.games
        WHERE game_date >= :d AND game_date <= DATEADD(day, 3, CAST(:d AS DATE))
        ORDER BY game_date ASC
    """)
    df = pd.read_sql(sql, engine, params={"d": grade_date_str})
    if df.empty:
        return None, None, {}
    season = int(df.iloc[0]["season"])
    week = int(df.iloc[0]["week"])
    team_game = {}
    for _, g in df.iterrows():
        team_game[str(g["home_team"])] = (str(g["game_id"]), str(g["away_team"]))
        team_game[str(g["away_team"])] = (str(g["game_id"]), str(g["home_team"]))
    return season, week, team_game


def resolve_player(engine, player_id) -> tuple[str, str, str] | None:
    """player_id (numeric gsis suffix) -> (gsis, position, team). None if unknown."""
    gsis = player_id_to_gsis(int(player_id))
    sql = text("""
        SELECT TOP 1 s.position, s.team
        FROM nfl.player_game_stats s
        WHERE s.player_gsis_id = :g
        ORDER BY s.season DESC, s.week DESC
    """)
    df = pd.read_sql(sql, engine, params={"g": gsis})
    if df.empty:
        return None
    return gsis, str(df.iloc[0]["position"]), str(df.iloc[0]["team"])


# ---------------------------------------------------------------------------
# Main grading loop
# ---------------------------------------------------------------------------


def grade_date(engine, grade_date_str: str, batch_size: int, force: bool):
    log.info("=== NFL grading for %s ===", grade_date_str)

    season, week, team_game = current_season_week(engine, grade_date_str)
    props = fetch_upcoming_nfl_props(engine, grade_date_str)

    if props.empty:
        if season is None:
            log.info("No NFL props and no games within 3 days (offseason/bye). Exiting.")
            return
        fresh = pd.read_sql(
            text("""
            SELECT COUNT(*) AS n FROM odds.upcoming_player_props
            WHERE sport_key = 'americanfootball_nfl'
              AND created_at >= DATEADD(hour, -48, GETUTCDATE())
        """),
            engine,
        ).iloc[0]["n"]
        if int(fresh) == 0:
            log.error(
                "No NFL props for %s with season %s week %s games scheduled and "
                "no fresh NFL props ingested in 48h. Odds pipeline is stale "
                "(check ODDS_API_KEY / odds-etl.yml). Failing loudly.",
                grade_date_str,
                season,
                week,
            )
            raise SystemExit(2)
        log.warning("No props matched %s but fresh NFL props exist (date shift?). Skipping.", grade_date_str)
        return

    # Per-market calibrators with pooled fallback (weekly_calibration.py is
    # the only writer). Identity/absent -> raw KDE probabilities.
    _calibrator_cache: dict = {}

    def calibrator_for(market_key):
        if market_key not in _calibrator_cache:
            try:
                _cal = load_calibrator(engine, "nfl", market_key)
                fn = None
                if _cal["method"] != "identity":

                    def fn(p, _c=_cal):
                        return float(apply_calibrator(_c, float(p)))

                log.info("Calibrator for nfl/%s: method=%s", market_key, _cal["method"])
                _calibrator_cache[market_key] = fn
            except Exception as exc:
                log.info("Calibrator load skipped for %s (%s); raw probabilities.", market_key, exc)
                _calibrator_cache[market_key] = None
        return _calibrator_cache[market_key]

    over_props = props[props["outcome_name"] == "Over"].copy()

    # Do not re-grade existing rows unless --force (grading rule). Existing
    # keys for this date are skipped; force regrades via the MERGE update path.
    if not force:
        existing = pd.read_sql(
            text("""SELECT event_id, market_key, player_id
                      FROM common.daily_grades
                     WHERE grade_date = :d AND model_version LIKE 'nfl%'"""),
            engine,
            params={"d": grade_date_str},
        )
        if not existing.empty:
            existing_keys = set(map(tuple, existing.itertuples(index=False, name=None)))
            before = len(over_props)
            over_props = over_props[
                ~over_props.apply(
                    lambda r: (
                        (str(r["event_id"]), r["market_key"], int(r["player_id"]) if pd.notna(r["player_id"]) else None)
                        in existing_keys
                    ),
                    axis=1,
                )
            ]
            if before - len(over_props):
                log.info("Skipping %d already-graded props (pass --force to re-grade).", before - len(over_props))
    league_cache: dict = {}
    grade_rows, tier_rows = [], []
    processed = 0

    for (event_id, market_key), group in over_props.groupby(["event_id", "market_key"]):
        if processed >= batch_size:
            break
        cfg = MARKET_CONFIG.get(market_key)
        if cfg is None:
            continue
        for _, prop in group.iterrows():
            if processed >= batch_size:
                break
            if pd.isna(prop["player_id"]) or pd.isna(prop["line_value"]):
                continue
            resolved = resolve_player(engine, prop["player_id"])
            if resolved is None:
                continue
            gsis, position, team = resolved

            game_log = fetch_game_log(engine, gsis, cfg["expr"], season, week)
            if game_log.empty:
                continue

            form = compute_form_grade(game_log, cfg)

            opponent = team_game.get(team, (None, None))[1]
            lg_key = (market_key, season, week)
            if lg_key not in league_cache:
                league_cache[lg_key] = fetch_league_allowed(engine, cfg["positions"], cfg["expr"], season, week)
            opp_allowed = (
                fetch_opponent_allowed(engine, opponent, cfg["positions"], cfg["expr"], season, week)
                if opponent
                else None
            )
            matchup = compute_matchup_grade(opp_allowed, league_cache[lg_key])

            volume = compute_volume_grade(fetch_snap_share(engine, gsis, season, week))
            composite = compute_composite(form, matchup, volume)

            tiers = compute_kde_tier_lines(game_log, composite, market_key, calibrator=calibrator_for(market_key))
            kde_window = KDE_WINDOW_HOT if composite >= 80 else KDE_WINDOW_MID if composite >= 50 else KDE_WINDOW_COLD

            game_id = team_game.get(team, (None, None))[0]
            player_id = gsis_to_player_id(gsis)
            over_price = prop["outcome_price"]

            grade_rows.append(
                {
                    "grade_date": grade_date_str,
                    "event_id": str(event_id),
                    "game_id": game_id,
                    "player_id": player_id,
                    "player_name": prop["player_name"],
                    "market_key": market_key,
                    "bookmaker_key": BOOKMAKER,
                    "line_value": float(prop["line_value"]),
                    "outcome_name": "Over",
                    "over_price": int(over_price) if not pd.isna(over_price) else None,
                    "outcome": None,
                    "composite_grade": round(composite, 2),
                    # Layer 1 always_required: the NFL sample analog is the
                    # game-log depth feeding the model.
                    "sample_size_60": int(len(game_log)),
                }
            )

            tier_row = {
                "grade_date": grade_date_str,
                "game_id": game_id,
                "player_id": player_id,
                "player_name": prop["player_name"],
                "market_key": market_key,
                "composite_grade": round(composite, 2),
                "kde_window": kde_window,
                # Layer 1 always_required; NFL never blowout-dampens.
                "blowout_dampened": 0,
            }
            for label in ("safe", "value", "highrisk", "lotto"):
                t = tiers.get(label)
                if t:
                    line, p = t
                    tier_row[f"{label}_line"] = line
                    tier_row[f"{label}_prob"] = round(p, 4)
                    tier_row[f"{label}_price"] = implied_to_american(p)
            tier_rows.append(tier_row)
            processed += 1

    grade_rows = validate_and_filter(grade_rows, "common.daily_grades", engine, "nfl-grading.yml")
    tier_rows = validate_and_filter(tier_rows, "common.player_tier_lines", engine, "nfl-grading.yml")
    upsert_daily_grades(engine, grade_rows)
    upsert_tier_lines(engine, tier_rows)
    log.info("Grading complete: %d props graded.", processed)


# ---------------------------------------------------------------------------
# Outcome settlement
# ---------------------------------------------------------------------------

_OUTCOME_CASE = """CASE
                WHEN actual.stat_val = dg.line_value THEN 'Push'
                WHEN dg.outcome_name = 'Over'  AND actual.stat_val > dg.line_value THEN 'Won'
                WHEN dg.outcome_name = 'Over'  AND actual.stat_val < dg.line_value THEN 'Lost'
                WHEN dg.outcome_name = 'Under' AND actual.stat_val < dg.line_value THEN 'Won'
                WHEN dg.outcome_name = 'Under' AND actual.stat_val > dg.line_value THEN 'Lost'
                ELSE NULL
            END"""


def run_outcomes(engine, specific_date: str | None = None) -> int:
    """Settle NULL-outcome NFL rows against nfl.player_game_stats for final
    games (nfl.games.home_score populated). Won/Lost/Push from the realized
    stat; DNP when the game is final and the player has no stats row."""
    date_clause = "AND dg.grade_date = :gd" if specific_date else ""
    params: dict = {"gd": specific_date} if specific_date else {}
    total = 0

    for market_key, cfg in MARKET_CONFIG.items():
        expr = cfg["expr"]
        sql = text(f"""
            UPDATE dg
            SET dg.outcome = {_OUTCOME_CASE}
            FROM common.daily_grades dg
            JOIN nfl.games g
              ON g.game_id = dg.game_id AND g.home_score IS NOT NULL
            JOIN (
                SELECT s.player_gsis_id, s.season, s.week,
                       CAST(s.{expr} AS FLOAT) AS stat_val
                FROM nfl.player_game_stats s
            ) actual
              ON actual.player_gsis_id = CONCAT('00-', RIGHT(CONCAT('0000000', dg.player_id), 7))
             AND actual.season = g.season AND actual.week = g.week
            WHERE dg.outcome IS NULL
              AND dg.player_id IS NOT NULL
              AND dg.game_id IS NOT NULL
              AND dg.market_key = '{market_key}'
              AND dg.model_version LIKE 'nfl%'
              {date_clause}
        """)
        with engine.begin() as conn:
            n = conn.execute(sql, params).rowcount
        if n:
            log.info("  %s: %d rows settled.", market_key, n)
            total += n

    mkt_list = ", ".join(f"'{k}'" for k in MARKET_CONFIG)
    dnp_sql = text(f"""
        UPDATE dg
        SET dg.outcome = 'DNP'
        FROM common.daily_grades dg
        JOIN nfl.games g
          ON g.game_id = dg.game_id AND g.home_score IS NOT NULL
        WHERE dg.outcome IS NULL
          AND dg.player_id IS NOT NULL
          AND dg.market_key IN ({mkt_list})
          AND dg.model_version LIKE 'nfl%'
          AND NOT EXISTS (
              SELECT 1 FROM nfl.player_game_stats s
              WHERE s.player_gsis_id = CONCAT('00-', RIGHT(CONCAT('0000000', dg.player_id), 7))
                AND s.season = g.season AND s.week = g.week
          )
          {date_clause}
    """)
    with engine.begin() as conn:
        n_dnp = conn.execute(dnp_sql, params).rowcount
    if n_dnp:
        log.info("  DNP: %d rows.", n_dnp)
        total += n_dnp

    log.info("Outcomes: %d rows settled.", total)
    return total


def main():
    parser = argparse.ArgumentParser(description="NFL prop grading model")
    parser.add_argument("--mode", choices=["upcoming", "outcomes"], default="upcoming")
    parser.add_argument("--date", default=None, help="Grade date YYYY-MM-DD (default: today UTC)")
    parser.add_argument("--batch", type=int, default=BATCH_DEFAULT)
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()

    engine = get_engine()
    ensure_schema(engine)
    ensure_integrity_tables(engine)
    if args.mode == "outcomes":
        run_outcomes(engine, specific_date=args.date)
    else:
        grade_date(engine, args.date or today_utc_date(), args.batch, args.force)
    log.info("=== NFL grading complete ===")


if __name__ == "__main__":
    main()
