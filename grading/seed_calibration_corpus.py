"""
seed_calibration_corpus.py — backtest-seed the calibration corpus.

MLB and NFL have almost no live resolved tier-line outcomes (MLB: one
May 2026 slate; NFL: none). Cold-starting their calibrators would leave
tier probabilities uncalibrated for months. This script replays the
production KDE tier-line machinery over HISTORICAL game logs, leakage-safe,
and resolves each generated (line, prob) against the realized stat —
producing (raw_prob, hit) pairs in common.calibration_corpus that
calibration_core.fetch_corpus unions in while the live corpus is thin
(< LIVE_CORPUS_MIN rows; live data supersedes the seed once it clears).

Leakage safety: for a sampled (player, game) target, the game log fed to
the KDE contains only games STRICTLY BEFORE the target game. The realized
stat is the target game's value. hit = stat > line; exact equality (push)
is skipped, matching the Won/Lost-only live corpus.

Replay uses composite=65 (mid KDE window) — tier structure, thresholds and
line scan are the production functions imported from the sport's grading
module, so the raw probability distribution matches what production emits.

Usage:
  python grading/seed_calibration_corpus.py --sport mlb
  python grading/seed_calibration_corpus.py --sport nfl
  python grading/seed_calibration_corpus.py --sport all   (default)
"""

import argparse
import logging

import pandas as pd
from sqlalchemy import text

from grading.calibration_core import ensure_calibration_schema
from grading import mlb_grade_props
from grading import nfl_grade_props

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger(__name__)

REPLAY_COMPOSITE = 65.0  # mid KDE window in both sports
MIN_PRIOR_GAMES = 10  # game-log depth required before a target game
SAMPLE_STRIDE = 7  # replay every Nth game per player (runtime control)

# Prop-listed proxy: only players whose season-mean stat clears this floor
# get replayed — FanDuel posts props for regulars, and seeding from fringe
# players would skew the corpus toward profiles that never get graded live.
MLB_MIN_MEAN_AB = 2.0

MLB_MARKETS = {
    "batter_hits": "hits",
    "batter_total_bases": "total_bases",
    "batter_home_runs": "home_runs",
    "batter_hits_runs_rbis": "(hits + runs + rbi)",
}
NFL_MARKETS = ("player_pass_yds", "player_rush_yds", "player_receptions", "player_reception_yds")


def _flush(engine, rows):
    """MERGE a batch of corpus rows (idempotent on the natural key)."""
    if not rows:
        return 0
    with engine.begin() as conn:
        conn.execute(
            text("""
            IF OBJECT_ID('tempdb..#stage_corpus') IS NOT NULL DROP TABLE #stage_corpus;
            CREATE TABLE #stage_corpus (
                sport VARCHAR(10), grade_date DATE, player_id BIGINT,
                market_key VARCHAR(100), tier VARCHAR(10),
                line_value FLOAT, raw_prob FLOAT, hit BIT
            );
        """)
        )
        conn.exec_driver_sql("INSERT INTO #stage_corpus VALUES (?,?,?,?,?,?,?,?)", rows)
        conn.execute(
            text("""
            MERGE common.calibration_corpus AS t
            USING #stage_corpus AS s
            ON t.sport = s.sport AND t.grade_date = s.grade_date
               AND t.player_id = s.player_id AND t.market_key = s.market_key
               AND t.tier = s.tier
            WHEN MATCHED THEN UPDATE SET
                t.line_value = s.line_value, t.raw_prob = s.raw_prob, t.hit = s.hit
            WHEN NOT MATCHED THEN INSERT
                (sport, grade_date, player_id, market_key, tier,
                 line_value, raw_prob, hit, source)
            VALUES (s.sport, s.grade_date, s.player_id, s.market_key, s.tier,
                    s.line_value, s.raw_prob, s.hit, 'backtest');
        """)
        )
    return len(rows)


def _replay_player(sport, player_id, market_key, df, kde_fn, out_rows):
    """df: one player's one-market game history, ascending by date, columns
    [grade_date, stat_value]. Emits corpus rows for sampled target games."""
    n = len(df)
    for i in range(MIN_PRIOR_GAMES, n, SAMPLE_STRIDE):
        prior = df.iloc[:i]
        target = df.iloc[i]
        # Production feeds most-recent-first logs into the KDE window.
        game_log = prior.iloc[::-1][["stat_value"]].reset_index(drop=True)
        tiers = kde_fn(game_log, REPLAY_COMPOSITE, market_key)
        if not tiers:
            continue
        realized = float(target["stat_value"])
        for label, t in tiers.items():
            if not t:
                continue
            line, prob = t
            if realized == line:  # push — excluded, matching live corpus
                continue
            out_rows.append(
                (
                    sport,
                    target["grade_date"],
                    int(player_id),
                    market_key,
                    label,
                    float(line),
                    float(prob),
                    1 if realized > line else 0,
                )
            )


def seed_mlb(engine) -> int:
    """Replay over deduped mlb.batting_stats (max-PA row per game/player)."""
    exprs = ", ".join(f"{sql_expr} AS [{mk}]" for mk, sql_expr in MLB_MARKETS.items())
    df = pd.read_sql(
        text(f"""
        SELECT player_id, CAST(game_date AS DATE) AS grade_date, {exprs}
        FROM (
            SELECT b.*, ROW_NUMBER() OVER (PARTITION BY b.game_pk, b.player_id
                                           ORDER BY b.plate_appearances DESC) AS rn
            FROM mlb.batting_stats b
        ) d
        WHERE d.rn = 1
          AND d.player_id IN (
              SELECT player_id FROM mlb.batting_stats
              GROUP BY player_id
              HAVING COUNT(*) >= {MIN_PRIOR_GAMES + 5}
                 AND AVG(CAST(at_bats AS FLOAT)) >= {MLB_MIN_MEAN_AB}
          )
        ORDER BY player_id, grade_date
    """),
        engine,
    )
    log.info(f"[mlb] {len(df)} player-games across {df['player_id'].nunique()} batters.")

    total = 0
    rows: list = []
    for pid, g in df.groupby("player_id"):
        for mk in MLB_MARKETS:
            sub = g[["grade_date", mk]].rename(columns={mk: "stat_value"}).dropna()
            _replay_player("mlb", pid, mk, sub.reset_index(drop=True), mlb_grade_props.compute_kde_tier_lines, rows)
        if len(rows) >= 5000:
            total += _flush(engine, rows)
            rows = []
    total += _flush(engine, rows)
    log.info(f"[mlb] seeded {total} corpus rows.")
    return total


def seed_nfl(engine) -> int:
    """Replay over nfl.player_game_stats for position-appropriate regulars."""
    total = 0
    for mk in NFL_MARKETS:
        cfg = nfl_grade_props.MARKET_CONFIG[mk]
        pos_list = ", ".join(f"'{p}'" for p in cfg["positions"])
        min_mean = cfg["floor"] * 0.5
        df = pd.read_sql(
            text(f"""
            SELECT s.player_gsis_id,
                   s.season, s.week,
                   g.game_date AS grade_date,
                   CAST(s.{cfg["expr"]} AS FLOAT) AS stat_value
            FROM nfl.player_game_stats s
            -- INNER join: a stats row with no schedule match has no real date;
            -- a sentinel date would collapse distinct weeks onto one corpus
            -- PK (MERGE dup failure) and corrupt the chronological split.
            JOIN nfl.games g
              ON g.season = s.season AND g.week = s.week
             AND (g.home_team = s.team OR g.away_team = s.team)
            WHERE s.position IN ({pos_list})
              AND s.{cfg["expr"]} IS NOT NULL
              AND s.player_gsis_id IN (
                  SELECT player_gsis_id FROM nfl.player_game_stats
                  WHERE position IN ({pos_list})
                  GROUP BY player_gsis_id
                  HAVING COUNT(*) >= {MIN_PRIOR_GAMES + 4}
                     AND AVG(CAST({cfg["expr"]} AS FLOAT)) >= {min_mean}
              )
            ORDER BY s.player_gsis_id, s.season, s.week
        """),
            engine,
        )
        log.info(f"[nfl] {mk}: {len(df)} player-games, {df['player_gsis_id'].nunique()} players.")
        rows: list = []
        for gsis, g in df.groupby("player_gsis_id"):
            pid = nfl_grade_props.gsis_to_player_id(gsis)
            if pid is None:
                continue
            sub = g[["grade_date", "stat_value"]].dropna().reset_index(drop=True)
            _replay_player("nfl", pid, mk, sub, nfl_grade_props.compute_kde_tier_lines, rows)
        total += _flush(engine, rows)
    log.info(f"[nfl] seeded {total} corpus rows.")
    return total


def main():
    parser = argparse.ArgumentParser(description="Seed the calibration corpus from backtests")
    parser.add_argument("--sport", choices=["mlb", "nfl", "all"], default="all")
    args = parser.parse_args()

    engine = mlb_grade_props.get_engine()
    ensure_calibration_schema(engine)
    if args.sport in ("mlb", "all"):
        seed_mlb(engine)
    if args.sport in ("nfl", "all"):
        seed_nfl(engine)
    log.info("Seeding complete.")


if __name__ == "__main__":
    main()
