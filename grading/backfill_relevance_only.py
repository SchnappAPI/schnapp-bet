"""
backfill_relevance_only.py — populate the four grading-v2 Phase-2 columns
(relevance_hit_rate, effective_n, role_minutes_current, role_volatility) on
existing common.daily_grades rows without touching any other column.

Why this script exists:
    Phase 2 added the four columns above. They are NULL on every row written
    before the Phase-2 deploy. weekly_calibration.fetch_grade_corpus filters
    on relevance_hit_rate IS NOT NULL AND effective_n IS NOT NULL, so the
    corpus is empty until rows have these features.

    Running grade_props.py --mode backfill --force re-grades every column,
    overwriting historical composite_grade / momentum_grade / hit_rate_60
    values with values computed from today's data. That destroys the
    historical "what the system predicted at the time" record.

    This script does the minimum needed to bootstrap the calibration corpus:
    compute the four new columns and UPDATE them in place, leaving every
    other column alone. Subsequent calibration runs treat these rows as
    eligible training data; original predictions remain intact.

Performance notes:
    Compute is the bottleneck on this workload. Two optimizations vs the
    naive form (call compute_relevance_weighted_hit_rate per row):
      1. Per-(player, market) weights cache. Weights depend only on the
         history rows + current_min + today_opp_id — none of which depend on
         line_value or direction. Each player has ~50 lines per market on a
         typical day; caching cuts ~50× redundant work.
      2. Vectorized weights via numpy. Replaces the iterrows + per-row
         Python _relevance_weight call with a single pass over each player's
         history (~60 rows). ~10× speedup on top of #1.
    SQL writes use shared.db.get_engine (fast_executemany=True) plus a
    #stage_rel temp table + UPDATE FROM JOIN per chunk.

Scope:
    --lookback (default 50) days back from today. Calibration uses 37 days
    (BACKTEST_TRAIN_DAYS=30 + BACKTEST_HOLDOUT_DAYS=7), so 50 leaves margin.

Usage:
    python grading/backfill_relevance_only.py
    python grading/backfill_relevance_only.py --lookback 60
    python grading/backfill_relevance_only.py --dry-run
"""

import argparse
import logging
import sys

import numpy as np
import pandas as pd
from sqlalchemy import text

from grading.grade_props import (
    fetch_history,
    fetch_player_role_context,
    fetch_opp_info,
    MARKET_STAT_MAP,
    _build_relevance_cache,
    _relevance_hit_rate_from_cache,
)
from shared.db import get_engine  # fast_executemany=True for bulk INSERT

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger(__name__)


def fetch_target_dates(engine, lookback_days):
    """Distinct grade_dates in the lookback window where at least one row
    needs the four new columns populated."""
    market_keys_in = ", ".join(f"'{m}'" for m in MARKET_STAT_MAP)
    sql = text(f"""
        SELECT DISTINCT CAST(grade_date AS DATE) AS gd
          FROM common.daily_grades
         WHERE grade_date >= DATEADD(day, -:lb, CAST(GETUTCDATE() AS DATE))
           AND relevance_hit_rate IS NULL
           AND market_key IN ({market_keys_in})
           AND player_id IS NOT NULL
         ORDER BY gd ASC
    """)
    df = pd.read_sql(sql, engine, params={"lb": int(lookback_days)})
    return df["gd"].astype(str).tolist()


def fetch_rows_for_date(engine, gd):
    """Pull (grade_id, player_id, market_key, line_value, outcome_name) for
    one date — only rows that still need the new columns."""
    market_keys_in = ", ".join(f"'{m}'" for m in MARKET_STAT_MAP)
    sql = text(f"""
        SELECT grade_id, player_id, market_key, line_value, outcome_name
          FROM common.daily_grades
         WHERE grade_date = :gd
           AND relevance_hit_rate IS NULL
           AND market_key IN ({market_keys_in})
           AND player_id IS NOT NULL
    """)
    return pd.read_sql(sql, engine, params={"gd": gd})


def update_chunk(engine, updates):
    """Bulk-update via #stage_rel temp table + UPDATE FROM JOIN.

    fast_executemany=True on the engine makes the INSERT a single-batch ODBC
    call; the UPDATE FROM is a single set-based statement. Roughly 30-50× the
    per-row UPDATE pattern this script started with.
    """
    if not updates:
        return
    rows = [(u["gid"], u["rhr"], u["en"], u["rmc"], u["rv"]) for u in updates]
    with engine.begin() as conn:
        conn.execute(text("IF OBJECT_ID('tempdb..#stage_rel') IS NOT NULL DROP TABLE #stage_rel"))
        conn.execute(text("""
            CREATE TABLE #stage_rel(
                grade_id BIGINT NOT NULL PRIMARY KEY,
                rhr FLOAT NULL,
                en  FLOAT NULL,
                rmc FLOAT NULL,
                rv  FLOAT NULL
            )
        """))
        conn.exec_driver_sql(
            "INSERT INTO #stage_rel(grade_id, rhr, en, rmc, rv) VALUES(?, ?, ?, ?, ?)",
            rows,
        )
        conn.execute(text("""
            UPDATE dg
               SET dg.relevance_hit_rate   = s.rhr,
                   dg.effective_n          = s.en,
                   dg.role_minutes_current = s.rmc,
                   dg.role_volatility      = s.rv
              FROM common.daily_grades dg
              JOIN #stage_rel s ON s.grade_id = dg.grade_id
        """))
        conn.execute(text("DROP TABLE #stage_rel"))


def process_date(engine, gd, batch_size):
    rows = fetch_rows_for_date(engine, gd)
    if rows.empty:
        log.info(f"  {gd}: 0 rows need filling.")
        return 0

    player_ids = rows["player_id"].dropna().astype(int).unique().tolist()
    market_keys = rows["market_key"].dropna().unique().tolist()

    history_df = fetch_history(engine, player_ids, market_keys, gd)
    role_context = fetch_player_role_context(engine, player_ids, gd)
    opp_info = fetch_opp_info(engine, player_ids, gd)
    opp_map = {pid: int(info["opp_team_id"]) for pid, info in opp_info.items()
               if info.get("opp_team_id") is not None}

    if history_df.empty or "game_minutes" not in history_df.columns:
        log.warning(f"  {gd}: no history with game_minutes — skipping {len(rows)} rows.")
        return 0

    # Cache weights+w_sum+effective_n once per (player_id, market_key) using
    # the shared helper that production grading (compute_all_hit_rates) also
    # calls. Single source of truth — any future tuning lands once.
    rel_cache = _build_relevance_cache(history_df, role_context, opp_map, gd)

    updates = []
    for _, r in rows.iterrows():
        pid = int(r["player_id"])
        mkt = r["market_key"]
        lv = float(r["line_value"])
        direction = "under" if r.get("outcome_name") == "Under" else "over"

        ctx = role_context.get(pid, {})
        cur_min = ctx.get("current_minutes")
        vol = ctx.get("role_volatility", 0.0)

        rhr, eff_n = _relevance_hit_rate_from_cache(rel_cache.get((pid, mkt)), lv, direction)

        updates.append({
            "gid": int(r["grade_id"]),
            "rhr": rhr,
            "en":  eff_n,
            "rmc": round(cur_min, 1) if cur_min is not None else None,
            "rv":  round(vol, 2) if vol is not None else None,
        })

    for i in range(0, len(updates), batch_size):
        update_chunk(engine, updates[i:i + batch_size])

    log.info(f"  {gd}: updated {len(updates)} rows ({len(cache)} cached groups).")
    return len(updates)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--lookback", type=int, default=50,
                        help="Days back from today (default 50; calibration window is 37).")
    parser.add_argument("--batch", type=int, default=2000,
                        help="Rows per bulk UPDATE FROM JOIN (default 2000).")
    parser.add_argument("--dry-run", action="store_true",
                        help="Print target dates and exit without writing.")
    args = parser.parse_args()

    engine = get_engine()
    dates = fetch_target_dates(engine, args.lookback)
    if not dates:
        log.info("Nothing to do — all rows in lookback window already have relevance_hit_rate.")
        return 0

    log.info(f"Lookback={args.lookback}d. {len(dates)} dates to process: {dates[0]} → {dates[-1]}")

    if args.dry_run:
        log.info("Dry run — exiting without writes.")
        return 0

    total = 0
    for gd in dates:
        log.info(f"Processing {gd}...")
        total += process_date(engine, gd, args.batch)
    log.info(f"Done. {total} rows updated across {len(dates)} dates.")
    return 0


if __name__ == "__main__":
    sys.exit(main() or 0)
