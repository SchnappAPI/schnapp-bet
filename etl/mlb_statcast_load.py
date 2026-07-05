"""
mlb_statcast_load.py

Phase 5 of docs/features/mlb-research-dashboard.md (ADR-20260705-1): land
Savant pitch-level Statcast into mlb.statcast_pitches, keyed
(game_pk, at_bat_number, pitch_number). Carries the modeled fields the
nightly StatsAPI play-by-play load cannot provide: true xBA/xSLG/xwOBA
(estimated_*_using_speedangle), swing/whiff description grain, bat speed,
swing length, attack angle.

Source is Savant directly via pybaseball.statcast() — NOT the Azure Parquet
lake (credentials retired, lake stale; see the ADR). Pulls are chunked into
<= 7-day windows with a courtesy sleep, staged into a FLOAT temp table
(fast_executemany binds some float batches as varchar — same 8114 gotcha as
#stage_trend), and MERGEd, so any window is safely re-runnable.

Modes:
  default            incremental — last 3 days ending today CT (Savant
                     publishes with up to a day of lag; overlap is free
                     under MERGE).
  --start/--end      explicit backfill range (YYYY-MM-DD, inclusive).

Runs exclusively in GitHub Actions on mac-runner (mlb-statcast-load.yml).
"""

import argparse
import logging
import sys
import time
from datetime import date, datetime, timedelta, timezone

import pandas as pd
from sqlalchemy import text

from shared.db import get_engine

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)s  %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger(__name__)

CHUNK_DAYS = 7
SLEEP_BETWEEN_CHUNKS = 3  # Savant courtesy pause, mirrors backfill_statcast.py

# Savant column -> mlb.statcast_pitches column. Narrow on purpose (ADR
# decision 3): keys + the fields Phase 5 exists to provide.
COLUMNS = {
    "game_pk": "game_pk",
    "at_bat_number": "at_bat_number",
    "pitch_number": "pitch_number",
    "game_date": "game_date",
    "batter": "batter_id",
    "pitcher": "pitcher_id",
    "pitch_type": "pitch_type",
    "release_speed": "release_speed",
    "description": "description",
    "events": "events",
    "zone": "zone",
    "launch_speed": "launch_speed",
    "launch_angle": "launch_angle",
    "bat_speed": "bat_speed",
    "swing_length": "swing_length",
    "attack_angle": "attack_angle",
    "estimated_ba_using_speedangle": "est_ba",
    "estimated_slg_using_speedangle": "est_slg",
    "estimated_woba_using_speedangle": "est_woba",
    "woba_value": "woba_value",
}
KEY_COLS = ["game_pk", "at_bat_number", "pitch_number"]

DDL_CREATE = """
IF OBJECT_ID('mlb.statcast_pitches', 'U') IS NULL
CREATE TABLE mlb.statcast_pitches (
    game_pk        INT           NOT NULL,
    at_bat_number  INT           NOT NULL,
    pitch_number   INT           NOT NULL,
    game_date      DATE          NULL,
    batter_id      INT           NULL,
    pitcher_id     INT           NULL,
    pitch_type     VARCHAR(5)    NULL,
    release_speed  FLOAT         NULL,
    description    VARCHAR(40)   NULL,
    events         VARCHAR(40)   NULL,
    zone           INT           NULL,
    launch_speed   FLOAT         NULL,
    launch_angle   FLOAT         NULL,
    bat_speed      FLOAT         NULL,
    swing_length   FLOAT         NULL,
    attack_angle   FLOAT         NULL,
    est_ba         FLOAT         NULL,
    est_slg        FLOAT         NULL,
    est_woba       FLOAT         NULL,
    woba_value     FLOAT         NULL,
    updated_at     DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_statcast_pitches
        PRIMARY KEY CLUSTERED (game_pk, at_bat_number, pitch_number)
);
"""

DDL_INDEXES = [
    """
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_statcast_pitches_date'
                   AND object_id = OBJECT_ID('mlb.statcast_pitches'))
        CREATE NONCLUSTERED INDEX IX_statcast_pitches_date
            ON mlb.statcast_pitches (game_date, batter_id);
    """,
    """
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_statcast_pitches_batter'
                   AND object_id = OBJECT_ID('mlb.statcast_pitches'))
        CREATE NONCLUSTERED INDEX IX_statcast_pitches_batter
            ON mlb.statcast_pitches (batter_id, game_date);
    """,
]

INT_COLS = ["game_pk", "at_bat_number", "pitch_number", "batter_id", "pitcher_id", "zone"]
STR_COLS = ["pitch_type", "description", "events"]


def ensure_table(engine):
    with engine.begin() as conn:
        conn.execute(text(DDL_CREATE))
        for stmt in DDL_INDEXES:
            conn.execute(text(stmt))


def today_ct() -> date:
    return datetime.now(timezone.utc).astimezone(timezone(timedelta(hours=-5))).date()


def chunk_windows(start: date, end: date):
    cursor = start
    while cursor <= end:
        yield cursor, min(cursor + timedelta(days=CHUNK_DAYS - 1), end)
        cursor = cursor + timedelta(days=CHUNK_DAYS)


def normalize(df: pd.DataFrame) -> pd.DataFrame:
    """Select + rename the Savant frame down to our columns, drop rows with
    null keys, dedupe on the PK (Savant occasionally repeats rows)."""
    present = {src: dst for src, dst in COLUMNS.items() if src in df.columns}
    missing = set(COLUMNS) - set(present)
    if missing:
        log.warning("Savant frame missing columns (loaded as NULL): %s", sorted(missing))
    out = df[list(present)].rename(columns=present)
    for dst in COLUMNS.values():
        if dst not in out.columns:
            out[dst] = None
    out = out.dropna(subset=KEY_COLS)
    out = out.drop_duplicates(subset=KEY_COLS, keep="last")
    out["game_date"] = pd.to_datetime(out["game_date"]).dt.strftime("%Y-%m-%d")
    for c in INT_COLS:
        out[c] = pd.to_numeric(out[c], errors="coerce")
    out = out.dropna(subset=KEY_COLS)
    return out


def merge_chunk(engine, df: pd.DataFrame) -> int:
    """Stage into #stage_sc (FLOAT columns — 8114 gotcha) and MERGE.
    Binds pure-Python dicts, never the pandas frame (SQL 245 gotcha)."""
    if df.empty:
        return 0
    records = []
    for row in df.to_dict("records"):
        rec = {}
        for c in COLUMNS.values():
            v = row.get(c)
            if v is None or (isinstance(v, float) and pd.isna(v)) or pd.isna(v):
                rec[c] = None
            elif c in INT_COLS:
                rec[c] = int(v)
            elif c in STR_COLS or c == "game_date":
                rec[c] = str(v)
            else:
                rec[c] = float(v)
        records.append(rec)

    all_cols = list(COLUMNS.values())
    non_key = [c for c in all_cols if c not in KEY_COLS]
    insert_cols = ", ".join(all_cols)
    param_names = ", ".join(f":{c}" for c in all_cols)
    set_clause = ", ".join(f"{c} = src.{c}" for c in non_key)
    src_cols = ", ".join(f"src.{c}" for c in all_cols)

    with engine.begin() as conn:
        conn.execute(text("IF OBJECT_ID('tempdb..#stage_sc') IS NOT NULL DROP TABLE #stage_sc"))
        conn.execute(
            text("""
            CREATE TABLE #stage_sc (
                game_pk       INT NOT NULL,
                at_bat_number INT NOT NULL,
                pitch_number  INT NOT NULL,
                game_date     DATE NULL,
                batter_id     INT NULL,
                pitcher_id    INT NULL,
                pitch_type    VARCHAR(5) NULL,
                release_speed FLOAT NULL,
                description   VARCHAR(40) NULL,
                events        VARCHAR(40) NULL,
                zone          INT NULL,
                launch_speed  FLOAT NULL,
                launch_angle  FLOAT NULL,
                bat_speed     FLOAT NULL,
                swing_length  FLOAT NULL,
                attack_angle  FLOAT NULL,
                est_ba        FLOAT NULL,
                est_slg       FLOAT NULL,
                est_woba      FLOAT NULL,
                woba_value    FLOAT NULL,
                PRIMARY KEY (game_pk, at_bat_number, pitch_number)
            )
        """)
        )
        conn.execute(
            text(f"INSERT INTO #stage_sc ({insert_cols}) VALUES ({param_names})"),
            records,
        )
        conn.execute(
            text(f"""
            MERGE mlb.statcast_pitches AS tgt
            USING #stage_sc AS src
              ON tgt.game_pk = src.game_pk
             AND tgt.at_bat_number = src.at_bat_number
             AND tgt.pitch_number = src.pitch_number
            WHEN MATCHED THEN UPDATE SET
                {set_clause},
                updated_at = SYSUTCDATETIME()
            WHEN NOT MATCHED THEN INSERT ({insert_cols}, updated_at)
            VALUES ({src_cols}, SYSUTCDATETIME());
        """)
        )
    return len(records)


def load_range(engine, start: date, end: date) -> int:
    from pybaseball import statcast

    total = 0
    for w_start, w_end in chunk_windows(start, end):
        df = statcast(start_dt=w_start.isoformat(), end_dt=w_end.isoformat(), verbose=False)
        if df is None or df.empty:
            log.info("%s..%s: no Savant rows.", w_start, w_end)
            continue
        norm = normalize(df)
        n = merge_chunk(engine, norm)
        total += n
        log.info("%s..%s: merged %d pitch rows (%d raw).", w_start, w_end, n, len(df))
        time.sleep(SLEEP_BETWEEN_CHUNKS)
    return total


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--start", help="YYYY-MM-DD (inclusive); default = 3 days ago CT")
    ap.add_argument("--end", help="YYYY-MM-DD (inclusive); default = today CT")
    args = ap.parse_args()

    end = date.fromisoformat(args.end) if args.end else today_ct()
    start = date.fromisoformat(args.start) if args.start else end - timedelta(days=2)
    if start > end:
        log.error("start %s is after end %s", start, end)
        sys.exit(2)

    engine = get_engine()
    ensure_table(engine)
    log.info("Loading Savant statcast pitches %s..%s into mlb.statcast_pitches.", start, end)
    total = load_range(engine, start, end)
    log.info("statcast_pitches: merged %d rows total for %s..%s.", total, start, end)
    # Pipeline truth (ADR-20260703-1): in-season zero-work is an error, not a
    # silent green. Off-season (no games scheduled in the window) is legal.
    if total == 0:
        with engine.connect() as conn:
            games = conn.execute(
                text("""
                    SELECT COUNT(*) FROM mlb.games
                    WHERE CAST(game_date AS DATE) BETWEEN :s AND :e
                """),
                {"s": start.isoformat(), "e": end.isoformat()},
            ).scalar()
        if games and games > 0:
            log.error(
                "0 Savant rows merged but mlb.games has %d games in %s..%s — "
                "Savant pull is broken or lagging; failing loudly.",
                games,
                start,
                end,
            )
            sys.exit(1)


if __name__ == "__main__":
    main()
