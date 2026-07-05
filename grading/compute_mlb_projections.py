"""
compute_mlb_projections.py

Materializes the two remaining ADR-20260420-2 (legacy ADR-0004) entities:

  mlb.batter_context      - one row per (game_date, game_pk, batter_id):
                            which side the batter is on, the opposing
                            probable SP + hand, venue, day/night, recent
                            batting-order slot, and whether the lineup is
                            confirmed (boxscore rows exist) or projected
                            (recent-appearance pool).
  mlb.batter_projections  - one row per (game_date, game_pk, batter_id,
                            market_key): a deterministic v1 projected value
                            per batter market plus a 0-1 confidence.

Projection model (proj-v1.1, intentionally simple and inspectable):
  rate markets   (hits, total_bases, home_runs):
      projection = blended per-PA rate (w10/w30/w60 weights from grading)
                   * expected PA (mean PA over last 15 games).
  count markets  (rbis, runs, singles, doubles, triples, walks,
                  strikeouts, stolen_bases, hits_runs_rbis):
      projection = mean per-game count over last 30 games.
  probability markets (hit_prob, hr_prob — Phase 4 of
                  docs/features/mlb-research-dashboard.md; these feed the
                  FanDuel batter-prop scans directly):
      P(>= 1 in the game) = 1 - (1 - p_pa)^expected_PA, where p_pa is the
      platoon-adjusted blended per-PA rate (hit rate / HR rate). The platoon
      factor scales the RATE, never the finished probability, so values
      stay in [0, 1]. v1.1 = v1.0 + these two keys; no other market logic
      changed, so pre-existing rows remain comparable.
  Platoon adjustment: when the opposing SP hand is known and the batter has
  >= 20 PA against that hand, scale by split_rate / overall_rate clamped to
  [0.8, 1.2].
  confidence = min(1, games_observed / 30), halved when the lineup is
  projected rather than confirmed.

Runs as a step in mlb-grading.yml before grading (probables land with the
09:00 mlb-etl; trend windows with the 09:30 PBP run). Idempotent: rows for
(game_date, game_pk) are replaced on re-run.
"""

import argparse
import logging
import sys
from datetime import datetime, timezone, timedelta

import pandas as pd
from sqlalchemy import text

from shared.db import get_engine

logging.basicConfig(level=logging.INFO, format="%(asctime)s  %(levelname)s  %(message)s", datefmt="%Y-%m-%d %H:%M:%S")
log = logging.getLogger(__name__)

MODEL_VERSION = "proj-v1.1"  # v1.1: + hit_prob / hr_prob probability markets

# Window weights mirror grading/mlb_grade_props.py
W10, W30, W60 = 0.25, 0.35, 0.40
MIN_SAMPLE = 5
MIN_SPLIT_PA = 20
PLATOON_CLAMP = (0.8, 1.2)
# Sanity ceiling on the platoon-adjusted per-PA rate feeding the
# probability markets — keeps 1-(1-p)^PA well-defined on tiny samples.
PROB_PA_RATE_CAP = 0.95

RATE_MARKETS = {
    "batter_hits": ("hit_rate", None),
    "batter_total_bases": ("tb_per_pa", None),
    "batter_home_runs": (None, "home_runs"),  # derived hrs/pa from window counts
}
COUNT_MARKETS = {
    "batter_rbis": "rbi",
    "batter_runs_scored": "runs",
    "batter_hits_runs_rbis": "(hits + runs + rbi)",
    "batter_singles": "(hits - doubles - triples - home_runs)",
    "batter_doubles": "doubles",
    "batter_triples": "triples",
    "batter_walks": "walks",
    "batter_strikeouts": "strikeouts",
    "batter_stolen_bases": "stolen_bases",
}

DDL = [
    """
    IF OBJECT_ID('mlb.batter_context', 'U') IS NULL
    CREATE TABLE mlb.batter_context (
        game_date        DATE         NOT NULL,
        game_pk          INT          NOT NULL,
        batter_id        INT          NOT NULL,
        team_id          INT          NULL,
        is_home          BIT          NULL,
        opp_pitcher_id   INT          NULL,
        opp_pitcher_hand CHAR(1)      NULL,
        venue_id         INT          NULL,
        venue_name       NVARCHAR(120) NULL,
        day_night        VARCHAR(10)  NULL,
        recent_batting_order INT      NULL,
        lineup_confirmed BIT          NOT NULL DEFAULT 0,
        updated_at       DATETIME2    NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_batter_context PRIMARY KEY (game_date, game_pk, batter_id)
    )
    """,
    """
    IF OBJECT_ID('mlb.batter_projections', 'U') IS NULL
    CREATE TABLE mlb.batter_projections (
        game_date       DATE        NOT NULL,
        game_pk         INT         NOT NULL,
        batter_id       INT         NOT NULL,
        market_key      VARCHAR(40) NOT NULL,
        projected_value FLOAT       NULL,
        confidence      FLOAT       NULL,
        model_version   VARCHAR(20) NOT NULL,
        updated_at      DATETIME2   NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_batter_projections
            PRIMARY KEY (game_date, game_pk, batter_id, market_key)
    )
    """,
]


def today_ct() -> str:
    return datetime.now(timezone.utc).astimezone(timezone(timedelta(hours=-5))).strftime("%Y-%m-%d")


def ensure_tables(engine):
    with engine.begin() as conn:
        for stmt in DDL:
            conn.execute(text(stmt))


def fetch_games(engine, game_date):
    return pd.read_sql(
        text("""
        SELECT game_pk, game_date, venue_id, venue_name, day_night,
               away_team_id, home_team_id,
               away_pitcher_id, away_pitcher_hand,
               home_pitcher_id, home_pitcher_hand
        FROM mlb.games
        WHERE CAST(game_date AS DATE) = :d
    """),
        engine,
        params={"d": game_date},
    )


def fetch_confirmed_lineup(engine, game_pk):
    # Pregame source first: mlb.daily_lineups holds CONFIRMED lineups from the
    # intraday poller hours before boxscore rows exist (ADR-20260704-1 future
    # step). Boxscore rows remain the fallback so historical/backfill dates
    # (which predate the poller) still resolve as confirmed.
    dl = pd.read_sql(
        text("""
        SELECT player_id, team_id,
               batting_order * 100 AS batting_order  -- 1-9 here; boxscore path is 100-scale
        FROM mlb.daily_lineups
        WHERE game_pk = :gp AND is_confirmed = 1
    """),
        engine,
        params={"gp": int(game_pk)},
    )
    if not dl.empty:
        return dl
    return pd.read_sql(
        text("""
        SELECT player_id, team_id, batting_order
        FROM mlb.batting_stats
        WHERE game_pk = :gp AND batting_order IS NOT NULL
    """),
        engine,
        params={"gp": int(game_pk)},
    )


def fetch_recent_pool(engine, team_id, game_date, n_team_games=10):
    """Players who appeared for team_id in its last n team games before
    game_date, with their most common recent batting order."""
    return pd.read_sql(
        text("""
        WITH team_games AS (
            SELECT DISTINCT TOP (:n) bs.game_pk, bs.game_date
            FROM mlb.batting_stats bs
            WHERE bs.team_id = :tid AND bs.game_date < :d
            ORDER BY bs.game_date DESC
        )
        SELECT bs.player_id,
               COUNT(*)                    AS appearances,
               MIN(bs.batting_order)       AS best_order,
               MAX(bs.game_date)           AS last_seen
        FROM mlb.batting_stats bs
        JOIN team_games tg ON tg.game_pk = bs.game_pk
        WHERE bs.team_id = :tid
        GROUP BY bs.player_id
    """),
        engine,
        params={"tid": int(team_id), "d": game_date, "n": n_team_games},
    )


def fetch_trend(engine, batter_ids, game_date):
    if not batter_ids:
        return pd.DataFrame()
    plist = ", ".join(str(int(b)) for b in batter_ids)
    return pd.read_sql(
        text(f"""
        SELECT ts.*
        FROM mlb.player_trend_stats ts
        INNER JOIN (
            SELECT batter_id, MAX(game_date) AS latest
            FROM mlb.player_trend_stats
            WHERE batter_id IN ({plist}) AND game_date < :d
            GROUP BY batter_id
        ) l ON l.batter_id = ts.batter_id AND l.latest = ts.game_date
    """),
        engine,
        params={"d": game_date},
    )


def fetch_game_averages(engine, batter_ids, game_date):
    """Per-game averages over the last 30 games and expected PA over the
    last 15, straight from the boxscore table."""
    if not batter_ids:
        return pd.DataFrame()
    plist = ", ".join(str(int(b)) for b in batter_ids)
    count_selects = ",\n               ".join(
        f"AVG(CAST({expr} AS FLOAT)) AS avg_{mk}" for mk, expr in COUNT_MARKETS.items()
    )
    return pd.read_sql(
        text(f"""
        WITH recent AS (
            SELECT bs.*,
                   ROW_NUMBER() OVER (PARTITION BY bs.player_id
                                      ORDER BY bs.game_date DESC) AS rn
            FROM mlb.batting_stats bs
            WHERE bs.player_id IN ({plist}) AND bs.game_date < :d
        )
        SELECT player_id,
               COUNT(*) AS games_observed,
               AVG(CASE WHEN rn <= 15 THEN CAST(plate_appearances AS FLOAT) END) AS expected_pa,
               {count_selects}
        FROM recent
        WHERE rn <= 30
        GROUP BY player_id
    """),
        engine,
        params={"d": game_date},
    )


def _blended_rate(ts, col):
    total_v = total_w = 0.0
    for w, wt in [(10, W10), (30, W30), (60, W60)]:
        v = ts.get(f"w{w}_{col}")
        pa = ts.get(f"w{w}_pa", 0) or 0
        if v is not None and not pd.isna(v) and pa >= MIN_SAMPLE:
            total_v += float(v) * wt
            total_w += wt
    return total_v / total_w if total_w else None


def _blended_hr_rate(ts):
    total_v = total_w = 0.0
    for w, wt in [(10, W10), (30, W30), (60, W60)]:
        hrs = ts.get(f"w{w}_home_runs", 0) or 0
        pa = ts.get(f"w{w}_pa", 0) or 0
        if pa >= MIN_SAMPLE:
            total_v += (hrs / pa) * wt
            total_w += wt
    return total_v / total_w if total_w else None


def _platoon_factor(ts, hand):
    if hand not in ("L", "R"):
        return 1.0
    split_rate = ts.get("vs_lhp_hit_rate" if hand == "L" else "vs_rhp_hit_rate")
    split_pa = ts.get("vs_lhp_pa" if hand == "L" else "vs_rhp_pa", 0) or 0
    overall = ts.get("w60_hit_rate")
    if (
        split_rate is None
        or pd.isna(split_rate)
        or split_pa < MIN_SPLIT_PA
        or overall is None
        or pd.isna(overall)
        or float(overall) <= 0
    ):
        return 1.0
    lo, hi = PLATOON_CLAMP
    return max(lo, min(hi, float(split_rate) / float(overall)))


def compute_for_date(engine, game_date):
    games = fetch_games(engine, game_date)
    if games.empty:
        log.info("No mlb.games rows for %s — nothing to project.", game_date)
        return 0, 0

    context_rows = []
    proj_rows = []

    for _, g in games.iterrows():
        game_pk = int(g["game_pk"])
        confirmed = fetch_confirmed_lineup(engine, game_pk)
        sides = [
            (int(g["away_team_id"]), False, g["home_pitcher_id"], g["home_pitcher_hand"]),
            (int(g["home_team_id"]), True, g["away_pitcher_id"], g["away_pitcher_hand"]),
        ]
        for team_id, is_home, opp_sp, opp_hand in sides:
            if not confirmed.empty:
                team_lineup = confirmed[confirmed["team_id"] == team_id]
                pool = pd.DataFrame(
                    {
                        "player_id": team_lineup["player_id"],
                        "best_order": team_lineup["batting_order"],
                    }
                )
                lineup_confirmed = True
            else:
                recent = fetch_recent_pool(engine, team_id, game_date)
                # Projected lineup: anyone in >= half the last 10 team games.
                pool = recent[recent["appearances"] >= 5][["player_id", "best_order"]]
                lineup_confirmed = False

            for _, p in pool.iterrows():
                context_rows.append(
                    {
                        "game_date": game_date,
                        "game_pk": game_pk,
                        "batter_id": int(p["player_id"]),
                        "team_id": team_id,
                        "is_home": 1 if is_home else 0,
                        "opp_pitcher_id": int(opp_sp) if pd.notna(opp_sp) else None,
                        "opp_pitcher_hand": opp_hand if opp_hand in ("L", "R") else None,
                        "venue_id": int(g["venue_id"]) if pd.notna(g["venue_id"]) else None,
                        "venue_name": g["venue_name"],
                        "day_night": g["day_night"],
                        "recent_batting_order": int(p["best_order"]) if pd.notna(p["best_order"]) else None,
                        "lineup_confirmed": 1 if lineup_confirmed else 0,
                    }
                )

    if not context_rows:
        log.info("No batter pool resolvable for %s.", game_date)
        return 0, 0

    ctx_df = pd.DataFrame(context_rows).drop_duplicates(subset=["game_date", "game_pk", "batter_id"])
    batter_ids = ctx_df["batter_id"].unique().tolist()
    trend = fetch_trend(engine, batter_ids, game_date)
    trend_map = {int(r["batter_id"]): r for _, r in trend.iterrows()}
    game_avgs = fetch_game_averages(engine, batter_ids, game_date)
    avg_map = {int(r["player_id"]): r for _, r in game_avgs.iterrows()}

    for _, c in ctx_df.iterrows():
        bid = int(c["batter_id"])
        ts = trend_map.get(bid, pd.Series(dtype=float))
        av = avg_map.get(bid)
        games_obs = int(av["games_observed"]) if av is not None else 0
        expected_pa = float(av["expected_pa"]) if av is not None and pd.notna(av["expected_pa"]) else None
        factor = _platoon_factor(ts, c["opp_pitcher_hand"])
        base_conf = min(1.0, games_obs / 30.0)
        conf = base_conf * (1.0 if c["lineup_confirmed"] else 0.5)

        def add(mk, value):
            proj_rows.append(
                {
                    "game_date": c["game_date"],
                    "game_pk": int(c["game_pk"]),
                    "batter_id": bid,
                    "market_key": mk,
                    "projected_value": round(float(value) * factor, 3) if value is not None else None,
                    "confidence": round(conf, 3),
                    "model_version": MODEL_VERSION,
                }
            )

        def add_prob(mk, p_pa_rate):
            # Probability markets bypass add(): the platoon factor scales
            # the per-PA RATE, and the finished P(>= 1) must stay in [0, 1].
            if p_pa_rate is None or expected_pa is None:
                return
            p_pa = min(PROB_PA_RATE_CAP, max(0.0, float(p_pa_rate) * factor))
            proj_rows.append(
                {
                    "game_date": c["game_date"],
                    "game_pk": int(c["game_pk"]),
                    "batter_id": bid,
                    "market_key": mk,
                    "projected_value": round(1.0 - (1.0 - p_pa) ** expected_pa, 3),
                    "confidence": round(conf, 3),
                    "model_version": MODEL_VERSION,
                }
            )

        if expected_pa:
            rate = _blended_rate(ts, "hit_rate")
            add("batter_hits", rate * expected_pa if rate is not None else None)
            add_prob("hit_prob", rate)
            rate = _blended_rate(ts, "tb_per_pa")
            add("batter_total_bases", rate * expected_pa if rate is not None else None)
            hr = _blended_hr_rate(ts)
            add("batter_home_runs", hr * expected_pa if hr is not None else None)
            add_prob("hr_prob", hr)
        for mk in COUNT_MARKETS:
            v = av[f"avg_{mk}"] if av is not None and pd.notna(av.get(f"avg_{mk}")) else None
            add(mk, v)

    proj_df = pd.DataFrame([r for r in proj_rows if r["projected_value"] is not None])

    with engine.begin() as conn:
        conn.execute(text("DELETE FROM mlb.batter_context WHERE game_date = :d"), {"d": game_date})
        conn.execute(text("DELETE FROM mlb.batter_projections WHERE game_date = :d"), {"d": game_date})
        if not ctx_df.empty:
            ctx_df.to_sql("batter_context", conn, schema="mlb", if_exists="append", index=False)
        if not proj_df.empty:
            proj_df.to_sql("batter_projections", conn, schema="mlb", if_exists="append", index=False)

    log.info("Wrote %d batter_context and %d batter_projections rows for %s.", len(ctx_df), len(proj_df), game_date)
    if not proj_df.empty:
        per_mkt = proj_df.groupby("market_key").size().sort_index()
        log.info("Rows per market: %s", ", ".join(f"{k}={v}" for k, v in per_mkt.items()))
    return len(ctx_df), len(proj_df)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--date", default=None, help="Game date (default: today CT)")
    args = parser.parse_args()
    game_date = args.date or today_ct()

    engine = get_engine()
    ensure_tables(engine)
    ctx, proj = compute_for_date(engine, game_date)
    if ctx == 0:
        # Off-day is fine; a full slate with no pool means upstream is stale.
        log.info("Done (no rows).")
    log.info("Done.")


if __name__ == "__main__":
    main()
