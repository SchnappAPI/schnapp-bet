"""
mlb_play_by_play.py

Loads pitch-level play-by-play data for MLB games into mlb.play_by_play, then
in-lockstep materializes derived tables for the same games:
  mlb.player_at_bats          — one row per completed at-bat, IDs only
  mlb.player_game_statcast    — one row per (batter, game), Statcast aggregates
                                 for the research dashboard (counts + EV/xBA
                                 sums so date windows re-aggregate correctly)
  mlb.career_batter_vs_pitcher — lifetime counts + rates per (batter, pitcher),
                                 plus quality-of-contact (EV/LA/dist/xBA,
                                 hard-hit, barrels) over ingested seasons
  mlb.player_trend_stats      — one row per (player_id, game_date), rolling
                                 10/30/60-game windows of hitting, EV, and
                                 platoon/home-away splits (platoon side also
                                 carries XBH/EV/xBA/BABIP quality columns)

Source: https://statsapi.mlb.com/api/v1/game/{game_pk}/withMetrics

Five tables written:
  mlb.play_by_play               — one row per play event (pitch, pickoff, baserunning)
  mlb.player_at_bats             — one row per completed at-bat, IDs only (no names)
  mlb.player_game_statcast       — one row per (batter_id, game_pk), per-game aggregates
  mlb.career_batter_vs_pitcher   — one row per (batter_id, pitcher_id) lifetime
  mlb.player_trend_stats         — one row per (batter_id, game_date), time-series

Why no denormalized names on player_at_bats:
  mlb.players is truncate-and-reload scoped to the current season, so roughly
  30% of pitcher_ids and 20% of batter_ids across historical PBP would land
  as NULL if we joined at write time. Web routes join mlb.players at read
  time instead — the table has under a thousand rows with a PK on player_id,
  so the read-time join is effectively free.

Write strategies (by table):
  play_by_play:
    Direct INSERT via to_sql(if_exists='append') + fast_executemany=True. The
    pre-diff against existing game_pks guarantees every game is new (ADR-0013).
  player_at_bats:
    Direct INSERT. Separate diff against player_at_bats.game_pk so partial
    runs (PBP wrote, at-bats failed) are self-healing (ADR-0018).
  player_game_statcast:
    Set-based INSERT..SELECT from player_at_bats, same pre-diff pattern as
    player_at_bats (source at-bat rows never change after load).
  career_batter_vs_pitcher:
    Staged MERGE. Unlike the other two, a (batter_id, pitcher_id) pair that
    appeared in a flush five runs ago already has a row; the new flush needs
    to update it, not insert a duplicate. For each flush, recompute lifetime
    rows for the (batter_id, pitcher_id) pairs present in the flushed games,
    stage to a temp table, MERGE into the permanent table.

Incremental logic:
  PBP:
    1. Load desired game_pk set from mlb.games (Final regular season games).
    2. Load existing game_pk set from mlb.play_by_play.
    3. Diff: only process games not already loaded.
    4. Process oldest --batch games per run.
  At-bats (always runs after each PBP flush, plus --rebuild-at-bats mode):
    1. Candidate game_pks = games present in mlb.play_by_play.
    2. Existing game_pks = games already in mlb.player_at_bats.
    3. Diff. For each new game, build at-bat rows from PBP and INSERT.
  Career BvP (always runs after each at-bats flush, plus --rebuild-bvp mode):
    1. Determine (batter_id, pitcher_id) pairs affected by the flushed games.
    2. Recompute lifetime counts + rates for those pairs from the full
       mlb.player_at_bats table.
    3. Stage + MERGE into mlb.career_batter_vs_pitcher.
  Player trend stats (always runs after each at-bats flush, plus
  --rebuild-trend-stats mode):
    1. Determine batter_ids and game_dates affected by the flushed games.
    2. Pull all prior at-bats for those batters in two bulk SQL reads (one for
       rolling stats, one for platoon splits via PBP join).
    3. Compute all three rolling windows and splits in pandas — no per-row SQL.
    4. Stage + MERGE into mlb.player_trend_stats on (batter_id, game_date).

Rebuild modes:
  --rebuild-at-bats: skip PBP fetch; rebuild mlb.player_at_bats from existing
    PBP data. Does NOT delete rows; for a full rebuild, DELETE first.
  --rebuild-bvp: skip PBP fetch; rebuild mlb.career_batter_vs_pitcher from
    the full mlb.player_at_bats table. Chunked by batter_id. Does NOT delete
    rows; for a full rebuild, DELETE first.
  --rebuild-trend-stats: skip PBP fetch; rebuild mlb.player_trend_stats from
    the full mlb.player_at_bats table. Chunked by batter_id. Does NOT delete
    rows; for a full rebuild, DELETE first.
  All rebuild flags are independent and compose.

Performance notes:
  API fetch loop uses ThreadPoolExecutor (FETCH_WORKERS=8) to overlap HTTP
  calls. Results are collected in game_date order before DB writes so the
  flush sequence stays deterministic. DB writes are single-threaded; local
  SQL Server serializes writes anyway.

  Trend-stats computation is entirely set-based: two bulk SQL reads per flush
  (one for at-bats, one for platoon splits via PBP join), then all windowing
  in pandas using groupby + rank. No per-(batter, date) SQL loop.

  FLUSH_EVERY=25 reduces the number of trend-stats+BvP merge cycles from
  10 to 2 per 50-game batch.

Runs exclusively in GitHub Actions. Credentials injected as environment variables.
"""

import sys
import time
import logging
from concurrent.futures import ThreadPoolExecutor, as_completed

import requests
import pandas as pd
import numpy as np
from sqlalchemy import text
from sqlalchemy.types import VARCHAR, Integer, Date, SmallInteger, Float, Boolean, NVARCHAR, DATETIME

from shared.db import get_engine

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)s  %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger(__name__)


def _current_mlb_season():
    """MLB seasons live inside one calendar year (Mar-Nov)."""
    from datetime import date

    return date.today().year


# Default when --seasons is omitted. Derived, not hardcoded: the previous
# literal [2025] silently pinned nightly runs to a finished season.
SEASONS = [_current_mlb_season()]
DEFAULT_BATCH = 50
API_PAUSE = 0.25
API_BASE = "https://statsapi.mlb.com/api/v1/game/{game_pk}/withMetrics"
FLUSH_EVERY = 25  # games per DB write; raised from 5 to reduce flush overhead
FETCH_WORKERS = 8  # concurrent HTTP fetch threads

# HR-pattern definitions for mlb.player_patterns (Phase 4 of
# docs/features/mlb-research-dashboard.md). The PBI report's DAX for its
# pattern card is inferred, so these are OUR explicit definitions:
# a batter is "in pattern" for PATTERN_WINDOW_GAMES games after a game with
# a HR; "early" repeats land within the first PATTERN_EARLY_GAMES of that
# window, "late" repeats in the remainder. hr_hot requires the batter to be
# inside the window now AND a repeat rate / sample floor so one lucky HR
# never lights the flag.
PATTERN_WINDOW_GAMES = 5
PATTERN_EARLY_GAMES = 2
HR_HOT_MIN_RATE = 0.5
HR_HOT_MIN_SAMPLES = 3

# Event types that are NOT plate appearances (baserunning / pickoff noise).
_NON_PA_EVENTS = frozenset(
    [
        "caught_stealing_2b",
        "caught_stealing_3b",
        "caught_stealing_home",
        "pickoff_1b",
        "pickoff_2b",
        "pickoff_caught_stealing_2b",
        "pickoff_caught_stealing_3b",
        "pickoff_caught_stealing_home",
        "pickoff_error_1b",
        "stolen_base_2b",
        "wild_pitch",
    ]
)

# Event types that are NOT at-bats (count as PA but not AB).
_NON_AB_EVENTS = frozenset(
    [
        "walk",
        "intent_walk",
        "hit_by_pitch",
        "sac_fly",
        "sac_fly_double_play",
        "sac_bunt",
        "sac_bunt_double_play",
        "catcher_interf",
    ]
)

_HIT_EVENTS = frozenset(["single", "double", "triple", "home_run"])
_WALK_EVENTS = frozenset(["walk", "intent_walk"])
_K_EVENTS = frozenset(["strikeout", "strikeout_double_play"])

# _NON_PA_EVENTS as a SQL literal list for NOT IN (...) predicates, so every
# aggregation path excludes the same baserunning/pickoff noise rows.
NON_PA_EVENTS_SQL = ", ".join(f"'{e}'" for e in sorted(_NON_PA_EVENTS))

# Explicit column types for to_sql. Prevents pandas from inferring VARCHAR(N)
# from batch data, which causes right-truncation when a later row is longer.
INSERT_DTYPES = {
    "play_event_id": VARCHAR(50),
    "game_date": Date(),
    "result_event_type": VARCHAR(50),
    "result_description": VARCHAR(1000),
    "batter_hand_code": VARCHAR(1),
    "batter_split": VARCHAR(30),
    "pitcher_hand_code": VARCHAR(1),
    "pitcher_split": VARCHAR(30),
    "play_id": VARCHAR(50),
    "play_event_type": VARCHAR(30),
    "pitch_call_code": VARCHAR(5),
    "pitch_type_code": VARCHAR(5),
    "play_event_description": VARCHAR(1000),
    "count_balls_strikes": VARCHAR(5),
    "hit_trajectory": VARCHAR(30),
    "hit_hardness": VARCHAR(20),
    "at_bat_end_time": DATETIME(),
    "play_end_time": DATETIME(),
    "play_event_end_time": DATETIME(),
}

AB_INSERT_DTYPES = {
    "at_bat_id": VARCHAR(30),
    "game_date": Date(),
    "result_event_type": VARCHAR(50),
    "result_description": VARCHAR(1000),
    "hit_trajectory": VARCHAR(30),
    "hit_hardness": VARCHAR(20),
}

DDL_CREATE = """
IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_SCHEMA = 'mlb' AND TABLE_NAME = 'play_by_play'
)
CREATE TABLE mlb.play_by_play (
    play_event_id              VARCHAR(50)   NOT NULL PRIMARY KEY,
    game_pk                    INT           NOT NULL,
    game_date                  DATE          NULL,
    at_bat_number              INT           NULL,
    play_event_index           INT           NULL,
    inning                     INT           NULL,
    is_top_inning              BIT           NULL,
    team_id                    INT           NULL,
    vs_team_id                 INT           NULL,
    away_team_id               INT           NULL,
    home_team_id               INT           NULL,
    venue_id                   INT           NULL,
    result_event_type          VARCHAR(50)   NULL,
    result_description         VARCHAR(1000) NULL,
    result_rbi                 INT           NULL,
    result_is_out              BIT           NULL,
    at_bat_is_complete         BIT           NULL,
    at_bat_is_scoring_play     BIT           NULL,
    at_bat_has_out             BIT           NULL,
    at_bat_end_time            DATETIME2     NULL,
    play_end_time              DATETIME2     NULL,
    batter_id                  INT           NULL,
    batter_hand_code           CHAR(1)       NULL,
    batter_split               VARCHAR(30)   NULL,
    pitcher_id                 INT           NULL,
    pitcher_hand_code          CHAR(1)       NULL,
    pitcher_split              VARCHAR(30)   NULL,
    play_id                    VARCHAR(50)   NULL,
    play_event_type            VARCHAR(30)   NULL,
    is_pitch                   BIT           NULL,
    is_base_running_play       BIT           NULL,
    pitch_number               INT           NULL,
    pitch_call_code            VARCHAR(5)    NULL,
    pitch_type_code            VARCHAR(5)    NULL,
    play_event_description     VARCHAR(1000) NULL,
    is_hit_into_play           BIT           NULL,
    is_strike                  BIT           NULL,
    is_ball                    BIT           NULL,
    is_out                     BIT           NULL,
    runner_going               BIT           NULL,
    count_balls_strikes        VARCHAR(5)    NULL,
    count_outs                 INT           NULL,
    is_last_pitch              BIT           NULL,
    is_at_bat                  BIT           NULL,
    is_plate_appearance        BIT           NULL,
    play_event_end_time        DATETIME2     NULL,
    pitch_start_speed          DECIMAL(5,1)  NULL,
    pitch_end_speed            DECIMAL(5,1)  NULL,
    pitch_zone                 INT           NULL,
    strike_zone_top            DECIMAL(5,2)  NULL,
    strike_zone_bottom         DECIMAL(5,2)  NULL,
    hit_launch_speed           DECIMAL(5,1)  NULL,
    hit_launch_angle           INT           NULL,
    hit_total_distance         INT           NULL,
    hit_trajectory             VARCHAR(30)   NULL,
    hit_hardness               VARCHAR(20)   NULL,
    hit_location               INT           NULL,
    hit_probability            DECIMAL(5,2)  NULL,
    hit_bat_speed              DECIMAL(5,1)  NULL,
    home_run_ballparks         INT           NULL,
    created_at                 DATETIME2     NOT NULL DEFAULT GETUTCDATE()
);
"""

DDL_ALTER_DESCRIPTIONS = """
IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = 'mlb' AND TABLE_NAME = 'play_by_play'
      AND COLUMN_NAME = 'result_description'
      AND CHARACTER_MAXIMUM_LENGTH < 1000
)
    ALTER TABLE mlb.play_by_play ALTER COLUMN result_description VARCHAR(1000) NULL;

IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = 'mlb' AND TABLE_NAME = 'play_by_play'
      AND COLUMN_NAME = 'play_event_description'
      AND CHARACTER_MAXIMUM_LENGTH < 1000
)
    ALTER TABLE mlb.play_by_play ALTER COLUMN play_event_description VARCHAR(1000) NULL;
"""

DDL_CREATE_PBP_INDEXES = """
IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = 'IX_play_by_play_game_pk'
      AND object_id = OBJECT_ID('mlb.play_by_play')
)
    CREATE NONCLUSTERED INDEX IX_play_by_play_game_pk
        ON mlb.play_by_play (game_pk);
"""

# mlb.batting_stats and mlb.pitching_stats are created by mlb_etl.py's upsert
# path, which has no DDL home, so their indexes live here. Guarded on table
# existence: on an empty DB this workflow can run before mlb_etl has created
# them, and CREATE INDEX on a missing table is a hard error.
DDL_CREATE_BOXSCORE_INDEXES = """
IF OBJECT_ID('mlb.batting_stats') IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = 'IX_batting_stats_game_pk'
      AND object_id = OBJECT_ID('mlb.batting_stats')
)
    CREATE NONCLUSTERED INDEX IX_batting_stats_game_pk
        ON mlb.batting_stats (game_pk);

IF OBJECT_ID('mlb.pitching_stats') IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = 'IX_pitching_stats_game_pk'
      AND object_id = OBJECT_ID('mlb.pitching_stats')
)
    CREATE NONCLUSTERED INDEX IX_pitching_stats_game_pk
        ON mlb.pitching_stats (game_pk);
"""

DDL_CREATE_AT_BATS = """
IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_SCHEMA = 'mlb' AND TABLE_NAME = 'player_at_bats'
)
CREATE TABLE mlb.player_at_bats (
    at_bat_id           VARCHAR(30)   NOT NULL PRIMARY KEY,
    game_pk             INT           NOT NULL,
    game_date           DATE          NULL,
    at_bat_number       INT           NOT NULL,
    inning              INT           NULL,
    is_top_inning       BIT           NULL,
    batter_id           INT           NULL,
    pitcher_id          INT           NULL,
    result_event_type   VARCHAR(50)   NULL,
    result_description  VARCHAR(1000) NULL,
    result_rbi          INT           NULL,
    hit_launch_speed    DECIMAL(5,1)  NULL,
    hit_launch_angle    INT           NULL,
    hit_total_distance  INT           NULL,
    hit_trajectory      VARCHAR(30)   NULL,
    hit_hardness        VARCHAR(20)   NULL,
    hit_probability     DECIMAL(5,2)  NULL,
    hit_bat_speed       DECIMAL(5,1)  NULL,
    home_run_ballparks  INT           NULL,
    away_team_id        INT           NULL,
    home_team_id        INT           NULL,
    created_at          DATETIME2     NOT NULL DEFAULT GETUTCDATE()
);
"""

# If the table already exists from the initial denormalized design, drop the
# name columns. Idempotent: only runs when the columns are still present.
DDL_DROP_NAME_COLUMNS = """
IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = 'mlb' AND TABLE_NAME = 'player_at_bats'
      AND COLUMN_NAME = 'batter_name'
)
    ALTER TABLE mlb.player_at_bats DROP COLUMN batter_name;

IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = 'mlb' AND TABLE_NAME = 'player_at_bats'
      AND COLUMN_NAME = 'pitcher_name'
)
    ALTER TABLE mlb.player_at_bats DROP COLUMN pitcher_name;
"""

DDL_CREATE_AT_BATS_INDEXES = """
IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = 'IX_player_at_bats_game_pk'
      AND object_id = OBJECT_ID('mlb.player_at_bats')
)
    CREATE NONCLUSTERED INDEX IX_player_at_bats_game_pk
        ON mlb.player_at_bats (game_pk);

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = 'IX_player_at_bats_batter'
      AND object_id = OBJECT_ID('mlb.player_at_bats')
)
    CREATE NONCLUSTERED INDEX IX_player_at_bats_batter
        ON mlb.player_at_bats (batter_id, game_date);
"""

# career_batter_vs_pitcher: lifetime counts + rates per (batter, pitcher).
# Compound PK (batter_id, pitcher_id), clustered. All rate stats stored
# pre-computed so the web can read without re-deriving AVG/OBP/SLG/OPS.
DDL_CREATE_BVP = """
IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_SCHEMA = 'mlb' AND TABLE_NAME = 'career_batter_vs_pitcher'
)
CREATE TABLE mlb.career_batter_vs_pitcher (
    batter_id        INT           NOT NULL,
    pitcher_id       INT           NOT NULL,
    plate_appearances INT          NOT NULL,
    at_bats          INT           NOT NULL,
    hits             INT           NOT NULL,
    singles          INT           NOT NULL,
    doubles          INT           NOT NULL,
    triples          INT           NOT NULL,
    home_runs        INT           NOT NULL,
    rbi              INT           NOT NULL,
    walks            INT           NOT NULL,
    strikeouts       INT           NOT NULL,
    hit_by_pitch     INT           NOT NULL,
    sac_flies        INT           NOT NULL,
    total_bases      INT           NOT NULL,
    batting_avg      DECIMAL(5,3)  NULL,
    obp              DECIMAL(5,3)  NULL,
    slg              DECIMAL(5,3)  NULL,
    ops              DECIMAL(5,3)  NULL,
    last_faced_date  DATE          NULL,
    updated_at       DATETIME2     NOT NULL DEFAULT GETUTCDATE(),
    CONSTRAINT PK_career_batter_vs_pitcher PRIMARY KEY CLUSTERED (batter_id, pitcher_id)
);
"""

DDL_CREATE_BVP_INDEXES = """
IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = 'IX_bvp_pitcher'
      AND object_id = OBJECT_ID('mlb.career_batter_vs_pitcher')
)
    CREATE NONCLUSTERED INDEX IX_bvp_pitcher
        ON mlb.career_batter_vs_pitcher (pitcher_id, batter_id);
"""

# mlb.player_trend_stats
# One row per (batter_id, game_date) — the batter's rolling profile *entering*
# that game (all prior games in the window are strictly before game_date).
# Three windows: w10 = last 10 games, w30 = last 30, w60 = last 60.
# Per window: plate_appearances, at_bats, hits, hit_rate, bb_rate, k_rate,
#   total_bases, tb_per_pa, home_runs, avg_ev, hard_hit_pct, barrel_pct, avg_xba.
# Split columns (computed over full history in loaded data, not windowed —
#   per-game PA is too sparse to window by split):
#   vs_lhp_pa, vs_lhp_hits, vs_lhp_hit_rate,
#   vs_rhp_pa, vs_rhp_hits, vs_rhp_hit_rate,
#   home_pa, home_hits, home_hit_rate,
#   away_pa, away_hits, away_hit_rate.
DDL_CREATE_TREND_STATS = """
IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_SCHEMA = 'mlb' AND TABLE_NAME = 'player_trend_stats'
)
CREATE TABLE mlb.player_trend_stats (
    batter_id         INT   NOT NULL,
    game_date         DATE  NOT NULL,
    -- 10-game window
    w10_pa            INT           NULL,
    w10_ab            INT           NULL,
    w10_hits          INT           NULL,
    w10_hit_rate      DECIMAL(5,3)  NULL,
    w10_bb_rate       DECIMAL(5,3)  NULL,
    w10_k_rate        DECIMAL(5,3)  NULL,
    w10_total_bases   INT           NULL,
    w10_tb_per_pa     DECIMAL(5,3)  NULL,
    w10_home_runs     INT           NULL,
    w10_avg_ev        DECIMAL(5,1)  NULL,
    w10_hard_hit_pct  DECIMAL(5,3)  NULL,
    w10_barrel_pct    DECIMAL(5,3)  NULL,
    w10_avg_xba       DECIMAL(5,3)  NULL,
    -- 30-game window
    w30_pa            INT           NULL,
    w30_ab            INT           NULL,
    w30_hits          INT           NULL,
    w30_hit_rate      DECIMAL(5,3)  NULL,
    w30_bb_rate       DECIMAL(5,3)  NULL,
    w30_k_rate        DECIMAL(5,3)  NULL,
    w30_total_bases   INT           NULL,
    w30_tb_per_pa     DECIMAL(5,3)  NULL,
    w30_home_runs     INT           NULL,
    w30_avg_ev        DECIMAL(5,1)  NULL,
    w30_hard_hit_pct  DECIMAL(5,3)  NULL,
    w30_barrel_pct    DECIMAL(5,3)  NULL,
    w30_avg_xba       DECIMAL(5,3)  NULL,
    -- 60-game window
    w60_pa            INT           NULL,
    w60_ab            INT           NULL,
    w60_hits          INT           NULL,
    w60_hit_rate      DECIMAL(5,3)  NULL,
    w60_bb_rate       DECIMAL(5,3)  NULL,
    w60_k_rate        DECIMAL(5,3)  NULL,
    w60_total_bases   INT           NULL,
    w60_tb_per_pa     DECIMAL(5,3)  NULL,
    w60_home_runs     INT           NULL,
    w60_avg_ev        DECIMAL(5,1)  NULL,
    w60_hard_hit_pct  DECIMAL(5,3)  NULL,
    w60_barrel_pct    DECIMAL(5,3)  NULL,
    w60_avg_xba       DECIMAL(5,3)  NULL,
    -- Platoon splits (full history in loaded data, not windowed)
    vs_lhp_pa         INT           NULL,
    vs_lhp_hits       INT           NULL,
    vs_lhp_hit_rate   DECIMAL(5,3)  NULL,
    vs_rhp_pa         INT           NULL,
    vs_rhp_hits       INT           NULL,
    vs_rhp_hit_rate   DECIMAL(5,3)  NULL,
    -- Home/away splits (full history in loaded data, not windowed)
    home_pa           INT           NULL,
    home_hits         INT           NULL,
    home_hit_rate     DECIMAL(5,3)  NULL,
    away_pa           INT           NULL,
    away_hits         INT           NULL,
    away_hit_rate     DECIMAL(5,3)  NULL,
    updated_at        DATETIME2     NOT NULL DEFAULT GETUTCDATE(),
    CONSTRAINT PK_player_trend_stats PRIMARY KEY CLUSTERED (batter_id, game_date)
);
"""

DDL_CREATE_TREND_STATS_INDEXES = """
IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = 'IX_trend_stats_date'
      AND object_id = OBJECT_ID('mlb.player_trend_stats')
)
    CREATE NONCLUSTERED INDEX IX_trend_stats_date
        ON mlb.player_trend_stats (game_date, batter_id);
"""

# mlb.player_game_statcast
# One row per (batter_id, game_pk): the batter's Statcast line for that game,
# pre-aggregated from mlb.player_at_bats. Counting stats are derived from
# at-bat results so they always reconcile with the per-AB log; `runs` is the
# one box-score-only stat (scoring is not an at-bat outcome) and comes from
# mlb.batting_stats, NULL when the box score is absent.
# Raw sums (ev_sum/bbe, xba_sum/xba_cnt, ...) are stored alongside the
# per-game averages so date-window queries can re-aggregate correctly
# (SUM(ev_sum)/SUM(bbe)) instead of averaging averages.
# hip = plate appearances ending with the ball in play
#     = pa - strikeouts - walks - hit_by_pitch - catcher interference.
DDL_CREATE_GAME_STATCAST = """
IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_SCHEMA = 'mlb' AND TABLE_NAME = 'player_game_statcast'
)
CREATE TABLE mlb.player_game_statcast (
    batter_id       INT           NOT NULL,
    game_pk         INT           NOT NULL,
    game_date       DATE          NULL,
    team_id         INT           NULL,
    opp_team_id     INT           NULL,
    opp_pitcher_id  INT           NULL,
    is_home         BIT           NULL,
    pa              INT           NULL,
    ab              INT           NULL,
    hits            INT           NULL,
    singles         INT           NULL,
    doubles         INT           NULL,
    triples         INT           NULL,
    home_runs       INT           NULL,
    xbh             INT           NULL,
    total_bases     INT           NULL,
    runs            INT           NULL,
    rbi             INT           NULL,
    strikeouts      INT           NULL,
    walks           INT           NULL,
    hit_by_pitch    INT           NULL,
    sac_flies       INT           NULL,
    hip             INT           NULL,
    bbe             INT           NULL,
    ev_sum          FLOAT         NULL,
    avg_ev          DECIMAL(5,1)  NULL,
    max_ev          DECIMAL(5,1)  NULL,
    la_cnt          INT           NULL,
    la_sum          FLOAT         NULL,
    avg_la          DECIMAL(5,1)  NULL,
    dist_cnt        INT           NULL,
    dist_sum        FLOAT         NULL,
    avg_dist        DECIMAL(6,1)  NULL,
    xba_cnt         INT           NULL,
    xba_sum         FLOAT         NULL,
    avg_xba         DECIMAL(5,3)  NULL,
    hard_hit        INT           NULL,
    barrels         INT           NULL,
    created_at      DATETIME2     NOT NULL DEFAULT GETUTCDATE(),
    CONSTRAINT PK_player_game_statcast PRIMARY KEY CLUSTERED (batter_id, game_pk)
);
"""

DDL_CREATE_GAME_STATCAST_INDEXES = """
IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = 'IX_player_game_statcast_date'
      AND object_id = OBJECT_ID('mlb.player_game_statcast')
)
    CREATE NONCLUSTERED INDEX IX_player_game_statcast_date
        ON mlb.player_game_statcast (game_date, batter_id);

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = 'IX_player_game_statcast_game'
      AND object_id = OBJECT_ID('mlb.player_game_statcast')
)
    CREATE NONCLUSTERED INDEX IX_player_game_statcast_game
        ON mlb.player_game_statcast (game_pk);
"""

# Quality-of-contact columns added to career_batter_vs_pitcher for the
# research dashboard (docs/features/mlb-research-dashboard.md). Aggregated
# from player_at_bats like every other column in the table, so "career"
# means the ingested-seasons horizon, not MLB-lifetime.
DDL_ALTER_BVP_QUALITY = """
IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = 'mlb' AND TABLE_NAME = 'career_batter_vs_pitcher'
      AND COLUMN_NAME = 'avg_ev'
)
    ALTER TABLE mlb.career_batter_vs_pitcher ADD
        bbe          INT           NULL,
        avg_ev       DECIMAL(5,1)  NULL,
        avg_la       DECIMAL(5,1)  NULL,
        avg_dist     DECIMAL(6,1)  NULL,
        avg_xba      DECIMAL(5,3)  NULL,
        hard_hit_ct  INT           NULL,
        barrel_ct    INT           NULL;
"""

# Per-hand quality-of-contact splits added to player_trend_stats (full
# history in loaded data, like the existing vs_lhp/vs_rhp hit-rate columns).
DDL_ALTER_TREND_PLATOON_QUALITY = """
IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = 'mlb' AND TABLE_NAME = 'player_trend_stats'
      AND COLUMN_NAME = 'vs_lhp_avg_ev'
)
    ALTER TABLE mlb.player_trend_stats ADD
        vs_lhp_xbh           INT           NULL,
        vs_lhp_avg_ev        DECIMAL(5,1)  NULL,
        vs_lhp_hard_hit_pct  DECIMAL(5,3)  NULL,
        vs_lhp_avg_xba       DECIMAL(5,3)  NULL,
        vs_lhp_babip         DECIMAL(5,3)  NULL,
        vs_rhp_xbh           INT           NULL,
        vs_rhp_avg_ev        DECIMAL(5,1)  NULL,
        vs_rhp_hard_hit_pct  DECIMAL(5,3)  NULL,
        vs_rhp_avg_xba       DECIMAL(5,3)  NULL,
        vs_rhp_babip         DECIMAL(5,3)  NULL;
"""

# HR-pattern state per (batter, as-of date), computed from
# mlb.player_game_statcast history (Phase 4, mlb-research-dashboard.md).
# One row per batter per date played, SAME-SEASON scope, computed THROUGH
# that date inclusive (unlike player_trend_stats' pre-game windows — a
# pattern row answers "where does he stand after tonight"). Readers pick
# the latest as_of_date < the upcoming game date, exactly like fetch_trend.
#
# Definitions (ours, not the PBI report's inferred DAX — see the constants
# PATTERN_WINDOW_GAMES / PATTERN_EARLY_GAMES / HR_HOT_* at the top):
#   games_played      - season games through as_of_date.
#   hr_games          - of those, games with >= 1 HR.
#   games_since_hr    - games after the most recent HR game (0 = homered on
#                       as_of_date); NULL when no HR yet this season.
#   pattern_samples   - HR games with >= 1 subsequent game played.
#   pattern_repeats   - samples where another HR game landed within the
#                       next PATTERN_WINDOW_GAMES games.
#   pattern_hit_rate  - repeats / samples.
#   hr_pattern_early  - share of repeats whose first follow-up HR came in
#                       the next 1..PATTERN_EARLY_GAMES games.
#   hr_pattern_late   - share in games PATTERN_EARLY_GAMES+1..WINDOW.
#   hr_hot            - still inside the window for TONIGHT's game, i.e.
#                       games_since_hr < WINDOW (at == WINDOW tonight would be
#                       game WINDOW+1 after the HR, beyond the repeat horizon)
#                       AND pattern_hit_rate >= HR_HOT_MIN_RATE
#                       AND pattern_samples >= HR_HOT_MIN_SAMPLES.
# Doubleheaders: both games of the date fold into one as-of row; game
# sequencing (not calendar days) drives every window.
DDL_CREATE_PATTERNS = """
IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_SCHEMA = 'mlb' AND TABLE_NAME = 'player_patterns'
)
CREATE TABLE mlb.player_patterns (
    batter_id        INT           NOT NULL,
    as_of_date       DATE          NOT NULL,
    season           INT           NOT NULL,
    games_played     INT           NULL,
    hr_games         INT           NULL,
    games_since_hr   INT           NULL,
    pattern_samples  INT           NULL,
    pattern_repeats  INT           NULL,
    pattern_hit_rate DECIMAL(5,3)  NULL,
    hr_pattern_early DECIMAL(5,3)  NULL,
    hr_pattern_late  DECIMAL(5,3)  NULL,
    hr_hot           BIT           NOT NULL DEFAULT 0,
    created_at       DATETIME2     NOT NULL DEFAULT GETUTCDATE(),
    CONSTRAINT PK_player_patterns PRIMARY KEY CLUSTERED (batter_id, as_of_date)
);
"""

DDL_CREATE_PATTERNS_INDEXES = """
IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = 'IX_player_patterns_date'
      AND object_id = OBJECT_ID('mlb.player_patterns')
)
    CREATE NONCLUSTERED INDEX IX_player_patterns_date
        ON mlb.player_patterns (as_of_date, batter_id);
"""


# ---------------------------------------------------------------------------
# Streak / drought conditional-frequency engine
# (docs/superpowers/specs/2026-07-12-streaks-trends-transparency-design.md)
#
# For a player + market + scope, the conditional next-game frequency given the
# player's current run-state: of all the times this player was in this exact
# state (streak d = d straight games WITH the event, or drought g = g straight
# WITHOUT), how often did the event happen the next game (k/N, N always shown).
# Display/context only — never folded into the projection. Run-state is
# within-season (streaks reset each season); "career" scope pools the
# within-season transition counts across all loaded seasons.
# ---------------------------------------------------------------------------

# Binary per-game event definitions, evaluated over the deduped batting_stats
# row (max plate_appearances per game_pk+player_id, matching the props board
# and the outcome-settlement dedup). "expr" maps a stats row dict -> bool.
STREAK_MARKETS = {
    "HR": lambda r: (r.get("home_runs") or 0) >= 1,
    "HIT": lambda r: (r.get("hits") or 0) >= 1,
    "HRR2": lambda r: ((r.get("hits") or 0) + (r.get("runs") or 0) + (r.get("rbi") or 0)) >= 2,
    "HRR3": lambda r: ((r.get("hits") or 0) + (r.get("runs") or 0) + (r.get("rbi") or 0)) >= 3,
    "RBI": lambda r: (r.get("rbi") or 0) >= 1,
}

# A drought length needs at least this many historical occurrences before it is
# eligible to define the player's "typical gap" (so one fluke gap never sets
# the cadence).
TYPICAL_GAP_MIN_SAMPLES = 2

DDL_CREATE_STREAK_STATE = """
IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_SCHEMA = 'mlb' AND TABLE_NAME = 'player_streak_state'
)
CREATE TABLE mlb.player_streak_state (
    batter_id          INT           NOT NULL,
    as_of_date         DATE          NOT NULL,
    market             VARCHAR(8)    NOT NULL,
    season             INT           NOT NULL,
    cur_state          VARCHAR(8)    NOT NULL,   -- 'streak' | 'drought' | 'none'
    cur_len            INT           NOT NULL,
    streak_ceiling     INT           NULL,       -- max event-streak this season
    streak_ceiling_car INT           NULL,       -- ... career
    typical_gap        INT           NULL,       -- season cadence (drought mode)
    phase              VARCHAR(8)    NULL,        -- 'early' | 'on' | 'late' (drought)
    at_ceiling         BIT           NOT NULL DEFAULT 0,
    season_n           INT           NULL,        -- times reached this state (season)
    season_hits        INT           NULL,        -- of those, event next game
    season_freq        DECIMAL(5,3)  NULL,
    career_n           INT           NULL,
    career_hits        INT           NULL,
    career_freq        DECIMAL(5,3)  NULL,
    created_at         DATETIME2     NOT NULL DEFAULT GETUTCDATE(),
    CONSTRAINT PK_player_streak_state PRIMARY KEY CLUSTERED (batter_id, as_of_date, market)
);
"""

DDL_CREATE_STREAK_STATE_INDEX = """
IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = 'IX_player_streak_state_date'
      AND object_id = OBJECT_ID('mlb.player_streak_state')
)
    CREATE NONCLUSTERED INDEX IX_player_streak_state_date
        ON mlb.player_streak_state (as_of_date, market, batter_id);
"""

# The full current curve for the trends page. Latest state per (batter, market,
# scope, state_type, state_len) — refreshed nightly, no per-as_of history (the
# props situation cell reads player_streak_state for a specific date instead).
DDL_CREATE_STREAK_DIST = """
IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_SCHEMA = 'mlb' AND TABLE_NAME = 'player_streak_dist'
)
CREATE TABLE mlb.player_streak_dist (
    batter_id     INT           NOT NULL,
    market        VARCHAR(8)    NOT NULL,
    scope         VARCHAR(8)    NOT NULL,   -- 'season' | 'career'
    state_type    VARCHAR(8)    NOT NULL,   -- 'streak' | 'drought'
    state_len     INT           NOT NULL,
    n_reached     INT           NOT NULL,
    n_event_next  INT           NOT NULL,
    freq          DECIMAL(5,3)  NOT NULL,
    as_of_date    DATE          NOT NULL,
    created_at    DATETIME2     NOT NULL DEFAULT GETUTCDATE(),
    CONSTRAINT PK_player_streak_dist
        PRIMARY KEY CLUSTERED (batter_id, market, scope, state_type, state_len)
);
"""


# ---------------------------------------------------------------------------
# Trend-stats: set-based computation (replaces per-row _compute_trend_row loop)
# ---------------------------------------------------------------------------


def _compute_trend_stats_bulk(engine, batter_ids, target_pairs):
    """
    Compute mlb.player_trend_stats rows for all (batter_id, game_date) pairs
    in target_pairs, for the given set of batter_ids.

    Reads the full prior-at-bat history for all affected batters in two SQL
    queries, then does all windowing in pandas. No per-row SQL loop.

    target_pairs: list of (batter_id, game_date) tuples to compute.
                  game_date values are the *target* dates (exclusive upper
                  bound — batter's profile entering that game).

    Returns a list of dicts ready for _merge_trend_stats.
    """
    if not batter_ids or not target_pairs:
        return []

    blist = ", ".join(str(b) for b in sorted(batter_ids))

    # Pull every at-bat for these batters, all time.
    # We need all history to support the w60 window for any target_date.
    ab_df = pd.read_sql(
        f"""
        SELECT
            batter_id,
            game_date,
            result_event_type,
            hit_launch_speed,
            hit_launch_angle,
            hit_probability,
            is_top_inning
        FROM mlb.player_at_bats
        WHERE batter_id IN ({blist})
          AND game_date IS NOT NULL
          AND result_event_type NOT IN (
            'caught_stealing_2b','caught_stealing_3b','caught_stealing_home',
            'pickoff_1b','pickoff_2b','pickoff_caught_stealing_2b',
            'pickoff_caught_stealing_3b','pickoff_caught_stealing_home',
            'pickoff_error_1b','stolen_base_2b','wild_pitch'
          )
        ORDER BY batter_id, game_date
    """,
        engine,
    )

    if ab_df.empty:
        return []

    ab_df["game_date"] = pd.to_datetime(ab_df["game_date"]).dt.date

    # Pull platoon splits: pitcher hand from PBP last-pitch join.
    # One bulk read for all affected batters.
    splits_df = pd.read_sql(
        f"""
        SELECT
            ab.batter_id,
            ab.game_date,
            pbp.pitcher_hand_code,
            ab.result_event_type,
            ab.hit_launch_speed,
            ab.hit_probability
        FROM mlb.player_at_bats ab
        JOIN mlb.play_by_play pbp
            ON pbp.game_pk = ab.game_pk
           AND pbp.at_bat_number = ab.at_bat_number
           AND pbp.is_last_pitch = 1
        WHERE ab.batter_id IN ({blist})
          AND ab.game_date IS NOT NULL
          AND ab.result_event_type NOT IN (
            'caught_stealing_2b','caught_stealing_3b','caught_stealing_home',
            'pickoff_1b','pickoff_2b','pickoff_caught_stealing_2b',
            'pickoff_caught_stealing_3b','pickoff_caught_stealing_home',
            'pickoff_error_1b','stolen_base_2b','wild_pitch'
          )
        ORDER BY ab.batter_id, ab.game_date
    """,
        engine,
    )

    if not splits_df.empty:
        splits_df["game_date"] = pd.to_datetime(splits_df["game_date"]).dt.date

    # Precompute per-at-bat indicator columns once, reused across all targets.
    ab_df["is_hit"] = ab_df["result_event_type"].isin(_HIT_EVENTS).astype(int)
    ab_df["is_ab"] = (~ab_df["result_event_type"].isin(_NON_AB_EVENTS)).astype(int)
    ab_df["is_bb"] = ab_df["result_event_type"].isin(_WALK_EVENTS).astype(int)
    ab_df["is_k"] = ab_df["result_event_type"].isin(_K_EVENTS).astype(int)
    ab_df["tb"] = (
        ab_df["result_event_type"].map({"single": 1, "double": 2, "triple": 3, "home_run": 4}).fillna(0).astype(int)
    )
    ab_df["is_hr"] = (ab_df["result_event_type"] == "home_run").astype(int)
    ab_df["ev"] = pd.to_numeric(ab_df["hit_launch_speed"], errors="coerce")
    ab_df["has_ev"] = ab_df["ev"].notna().astype(int)
    ab_df["ev_val"] = ab_df["ev"].fillna(0.0)
    ab_df["hard_hit"] = (ab_df["ev"] >= 95).astype(int)
    ab_df["barrel"] = (
        (ab_df["ev"] >= 95) & (pd.to_numeric(ab_df["hit_launch_angle"], errors="coerce").between(8, 32))
    ).astype(int)
    ab_df["xba"] = pd.to_numeric(ab_df["hit_probability"], errors="coerce")
    ab_df["has_xba"] = ab_df["xba"].notna().astype(int)
    ab_df["xba_val"] = ab_df["xba"].fillna(0.0)

    # Group by (batter_id, game_date) to get per-game aggregates once.
    # The rolling windows operate over games, not individual at-bats.
    gpg = (
        ab_df.groupby(["batter_id", "game_date"])
        .agg(
            pa=("is_hit", "count"),  # all rows = PA
            ab=("is_ab", "sum"),
            hits=("is_hit", "sum"),
            bbs=("is_bb", "sum"),
            ks=("is_k", "sum"),
            tb=("tb", "sum"),
            hrs=("is_hr", "sum"),
            bbe=("has_ev", "sum"),
            ev_sum=("ev_val", "sum"),
            hard_hit=("hard_hit", "sum"),
            barrels=("barrel", "sum"),
            xba_cnt=("has_xba", "sum"),
            xba_sum=("xba_val", "sum"),
        )
        .reset_index()
    )
    gpg = gpg.sort_values(["batter_id", "game_date"])

    # Build a lookup: batter_id -> sorted array of (game_date, row_index) so
    # we can efficiently slice prior games for any target_date.
    batter_groups = {bid: grp.reset_index(drop=True) for bid, grp in gpg.groupby("batter_id")}

    # Precompute full-history splits per (batter_id, game_date) using the
    # splits_df. We compute cumulative sums sorted by date so that for any
    # target_date we can look up "all rows before that date" in O(1).
    # Split cols: vs_lhp_pa, vs_lhp_hits, vs_rhp_pa, vs_rhp_hits,
    #             home_pa, home_hits, away_pa, away_hits.
    splits_records = {}  # (batter_id, game_date) -> dict of split counts (all prior)

    if not splits_df.empty:
        splits_df["is_hit"] = splits_df["result_event_type"].isin(_HIT_EVENTS).astype(int)
        splits_df["vs_lhp"] = (splits_df["pitcher_hand_code"] == "L").astype(int)
        splits_df["vs_lhp_hit"] = (splits_df["vs_lhp"] & splits_df["is_hit"].astype(bool)).astype(int)
        splits_df["vs_rhp"] = (splits_df["pitcher_hand_code"] == "R").astype(int)
        splits_df["vs_rhp_hit"] = (splits_df["vs_rhp"] & splits_df["is_hit"].astype(bool)).astype(int)
        # Placeholder only — real home/away splits are derived from ab_df
        # below (is_top_inning lives on the at-bat rows, not the PBP slice).
        # The previous ternary here was inverted and crashed every trend-stats
        # flush with AttributeError when is_top_inning was absent.
        splits_df["home"] = pd.Series(0, index=splits_df.index)
        splits_df["home_hit"] = pd.Series(0, index=splits_df.index)
        splits_df["away"] = pd.Series(0, index=splits_df.index)
        splits_df["away_hit"] = pd.Series(0, index=splits_df.index)

        # home/away from ab_df (is_top_inning), joined back via (batter_id, game_date, result_event_type)
        # Simpler: re-derive from ab_df directly since we have is_top_inning there.
        # We merge ab_df home/away indicators into splits_df isn't needed —
        # the splits for home/away come from ab_df (is_top_inning), not PBP.
        # We build the home/away split separately from ab_df.
        pass

    # Build home/away splits from ab_df (no PBP join needed — is_top_inning is on ab).
    ab_df["home"] = (ab_df["is_top_inning"] == 0).astype(int)
    ab_df["home_hit"] = (ab_df["home"].astype(bool) & ab_df["is_hit"].astype(bool)).astype(int)
    ab_df["away"] = (ab_df["is_top_inning"] == 1).astype(int)
    ab_df["away_hit"] = (ab_df["away"].astype(bool) & ab_df["is_hit"].astype(bool)).astype(int)

    ha_gpg = (
        ab_df.groupby(["batter_id", "game_date"])
        .agg(
            home_pa=("home", "sum"),
            home_hits=("home_hit", "sum"),
            away_pa=("away", "sum"),
            away_hits=("away_hit", "sum"),
        )
        .reset_index()
        .sort_values(["batter_id", "game_date"])
    )

    ha_batter_groups = {bid: grp.reset_index(drop=True) for bid, grp in ha_gpg.groupby("batter_id")}

    # Build platoon (LHP/RHP) cumulative data per batter. Beyond PA/hits,
    # each hand also accumulates quality-of-contact (XBH, EV, hard-hit, xBA)
    # and BABIP components. Definitions match the windowed columns above and
    # the SQL rebuild path in rebuild_trend_stats — keep all three in lockstep.
    platoon_batter_groups = {}
    if not splits_df.empty:
        splits_df["is_hit2"] = splits_df["result_event_type"].isin(_HIT_EVENTS).astype(int)
        splits_df["is_xbh2"] = splits_df["result_event_type"].isin(("double", "triple", "home_run")).astype(int)
        splits_df["is_ab2"] = (~splits_df["result_event_type"].isin(_NON_AB_EVENTS)).astype(int)
        splits_df["is_k2"] = splits_df["result_event_type"].isin(_K_EVENTS).astype(int)
        splits_df["is_hr2"] = (splits_df["result_event_type"] == "home_run").astype(int)
        splits_df["is_sf2"] = splits_df["result_event_type"].isin(("sac_fly", "sac_fly_double_play")).astype(int)
        splits_df["ev2"] = pd.to_numeric(splits_df["hit_launch_speed"], errors="coerce")
        splits_df["xba2"] = pd.to_numeric(splits_df["hit_probability"], errors="coerce")

        agg_spec = {}
        for hand, pfx in (("L", "vs_lhp"), ("R", "vs_rhp")):
            m = splits_df["pitcher_hand_code"] == hand
            splits_df[f"{pfx}"] = m.astype(int)
            splits_df[f"{pfx}_hit"] = (m & splits_df["is_hit2"].astype(bool)).astype(int)
            splits_df[f"{pfx}_xbh_i"] = (m & splits_df["is_xbh2"].astype(bool)).astype(int)
            splits_df[f"{pfx}_ab_i"] = (m & splits_df["is_ab2"].astype(bool)).astype(int)
            splits_df[f"{pfx}_so_i"] = (m & splits_df["is_k2"].astype(bool)).astype(int)
            splits_df[f"{pfx}_hr_i"] = (m & splits_df["is_hr2"].astype(bool)).astype(int)
            splits_df[f"{pfx}_sf_i"] = (m & splits_df["is_sf2"].astype(bool)).astype(int)
            splits_df[f"{pfx}_bbe_i"] = (m & splits_df["ev2"].notna()).astype(int)
            splits_df[f"{pfx}_ev_v"] = np.where(m, splits_df["ev2"].fillna(0.0), 0.0)
            splits_df[f"{pfx}_hh_i"] = (m & (splits_df["ev2"] >= 95)).astype(int)
            splits_df[f"{pfx}_xba_c"] = (m & splits_df["xba2"].notna()).astype(int)
            splits_df[f"{pfx}_xba_v"] = np.where(m, splits_df["xba2"].fillna(0.0), 0.0)
            agg_spec.update(
                {
                    f"{pfx}_pa": (f"{pfx}", "sum"),
                    f"{pfx}_hits": (f"{pfx}_hit", "sum"),
                    f"{pfx}_xbh": (f"{pfx}_xbh_i", "sum"),
                    f"{pfx}_ab": (f"{pfx}_ab_i", "sum"),
                    f"{pfx}_so": (f"{pfx}_so_i", "sum"),
                    f"{pfx}_hr": (f"{pfx}_hr_i", "sum"),
                    f"{pfx}_sf": (f"{pfx}_sf_i", "sum"),
                    f"{pfx}_bbe": (f"{pfx}_bbe_i", "sum"),
                    f"{pfx}_ev_sum": (f"{pfx}_ev_v", "sum"),
                    f"{pfx}_hard_hit": (f"{pfx}_hh_i", "sum"),
                    f"{pfx}_xba_cnt": (f"{pfx}_xba_c", "sum"),
                    f"{pfx}_xba_sum": (f"{pfx}_xba_v", "sum"),
                }
            )

        pl_gpg = (
            splits_df.groupby(["batter_id", "game_date"])
            .agg(**agg_spec)
            .reset_index()
            .sort_values(["batter_id", "game_date"])
        )

        platoon_batter_groups = {bid: grp.reset_index(drop=True) for bid, grp in pl_gpg.groupby("batter_id")}

    def _sum_prior(grp, target_date):
        """Sum all rows where game_date < target_date."""
        mask = grp["game_date"] < target_date
        return grp[mask]

    def _safe_rate(num, den):
        return round(float(num) / float(den), 3) if den and den > 0 else None

    def _safe_ev(ev_sum, bbe):
        return round(float(ev_sum) / float(bbe), 1) if bbe and bbe > 0 else None

    records = []
    for batter_id, game_date in target_pairs:
        batter_id = int(batter_id)
        grp = batter_groups.get(batter_id)
        if grp is None:
            continue

        # For each window size, take the N most recent games before game_date.
        prior = grp[grp["game_date"] < game_date].copy()
        if prior.empty:
            continue  # batter's first game, no prior history

        # Sort descending by game_date for window slicing.
        prior_desc = prior.sort_values("game_date", ascending=False)

        rec = {"batter_id": batter_id, "game_date": str(game_date)}

        for n, prefix in [(10, "w10"), (30, "w30"), (60, "w60")]:
            w = prior_desc.head(n)
            pa = int(w["pa"].sum())
            ab = int(w["ab"].sum())
            hits = int(w["hits"].sum())
            bbs = int(w["bbs"].sum())
            ks = int(w["ks"].sum())
            tb = int(w["tb"].sum())
            hrs = int(w["hrs"].sum())
            bbe = int(w["bbe"].sum())
            ev_s = float(w["ev_sum"].sum())
            hh = int(w["hard_hit"].sum())
            bar = int(w["barrels"].sum())
            xc = int(w["xba_cnt"].sum())
            xs = float(w["xba_sum"].sum())

            rec[f"{prefix}_pa"] = pa
            rec[f"{prefix}_ab"] = ab
            rec[f"{prefix}_hits"] = hits
            rec[f"{prefix}_hit_rate"] = _safe_rate(hits, pa)
            rec[f"{prefix}_bb_rate"] = _safe_rate(bbs, pa)
            rec[f"{prefix}_k_rate"] = _safe_rate(ks, pa)
            rec[f"{prefix}_total_bases"] = tb
            rec[f"{prefix}_tb_per_pa"] = _safe_rate(tb, pa)
            rec[f"{prefix}_home_runs"] = hrs
            rec[f"{prefix}_avg_ev"] = _safe_ev(ev_s, bbe)
            rec[f"{prefix}_hard_hit_pct"] = _safe_rate(hh, bbe)
            rec[f"{prefix}_barrel_pct"] = _safe_rate(bar, bbe)
            # xba stored as probability (0-1 range); divide sum by count
            rec[f"{prefix}_avg_xba"] = round(xs / xc / 100, 3) if xc > 0 else None

        # Home/away splits (full history before game_date)
        ha_grp = ha_batter_groups.get(batter_id)
        if ha_grp is not None:
            ha = ha_grp[ha_grp["game_date"] < game_date]
            rec["home_pa"] = int(ha["home_pa"].sum())
            rec["home_hits"] = int(ha["home_hits"].sum())
            rec["home_hit_rate"] = _safe_rate(rec["home_hits"], rec["home_pa"])
            rec["away_pa"] = int(ha["away_pa"].sum())
            rec["away_hits"] = int(ha["away_hits"].sum())
            rec["away_hit_rate"] = _safe_rate(rec["away_hits"], rec["away_pa"])
        else:
            rec["home_pa"] = rec["home_hits"] = rec["home_hit_rate"] = None
            rec["away_pa"] = rec["away_hits"] = rec["away_hit_rate"] = None

        # Platoon splits (full history before game_date)
        pl_grp = platoon_batter_groups.get(batter_id)
        if pl_grp is not None:
            pl = pl_grp[pl_grp["game_date"] < game_date]
            for pfx in ("vs_lhp", "vs_rhp"):
                pa_h = int(pl[f"{pfx}_pa"].sum())
                hits_h = int(pl[f"{pfx}_hits"].sum())
                bbe_h = int(pl[f"{pfx}_bbe"].sum())
                xc_h = int(pl[f"{pfx}_xba_cnt"].sum())
                ab_h = int(pl[f"{pfx}_ab"].sum())
                so_h = int(pl[f"{pfx}_so"].sum())
                hr_h = int(pl[f"{pfx}_hr"].sum())
                sf_h = int(pl[f"{pfx}_sf"].sum())
                babip_den = ab_h - so_h - hr_h + sf_h
                rec[f"{pfx}_pa"] = pa_h
                rec[f"{pfx}_hits"] = hits_h
                rec[f"{pfx}_hit_rate"] = _safe_rate(hits_h, pa_h)
                rec[f"{pfx}_xbh"] = int(pl[f"{pfx}_xbh"].sum())
                rec[f"{pfx}_avg_ev"] = _safe_ev(float(pl[f"{pfx}_ev_sum"].sum()), bbe_h)
                rec[f"{pfx}_hard_hit_pct"] = _safe_rate(int(pl[f"{pfx}_hard_hit"].sum()), bbe_h)
                # xba stored as probability (0-100 range); same scaling as windows
                rec[f"{pfx}_avg_xba"] = round(float(pl[f"{pfx}_xba_sum"].sum()) / xc_h / 100, 3) if xc_h > 0 else None
                rec[f"{pfx}_babip"] = _safe_rate(hits_h - hr_h, babip_den)
        else:
            for pfx in ("vs_lhp", "vs_rhp"):
                rec[f"{pfx}_pa"] = rec[f"{pfx}_hits"] = rec[f"{pfx}_hit_rate"] = None
                rec[f"{pfx}_xbh"] = rec[f"{pfx}_avg_ev"] = rec[f"{pfx}_hard_hit_pct"] = None
                rec[f"{pfx}_avg_xba"] = rec[f"{pfx}_babip"] = None

        records.append(rec)

    return records


def load_trend_stats_for_games(engine, game_pks):
    """
    Materialize mlb.player_trend_stats rows for every (batter_id, game_date)
    pair present in the given game_pks.

    Uses set-based bulk computation: two SQL reads for all affected batters,
    all windowing in pandas, single MERGE at the end. No per-row SQL loop.
    """
    if not game_pks:
        return

    game_pks = list(set(int(g) for g in game_pks))
    placeholders = ", ".join(str(g) for g in game_pks)

    with engine.connect() as conn:
        pairs = conn.execute(
            text(f"""
            SELECT DISTINCT batter_id, game_date
            FROM mlb.player_at_bats
            WHERE game_pk IN ({placeholders})
              AND batter_id IS NOT NULL
              AND game_date IS NOT NULL
        """)
        ).fetchall()

        if not pairs:
            log.info("trend_stats: no batter/date pairs for %d games.", len(game_pks))
            return

        existing = set(
            conn.execute(
                text(f"""
            SELECT batter_id, game_date
            FROM mlb.player_trend_stats
            WHERE batter_id IN (
                SELECT DISTINCT batter_id FROM mlb.player_at_bats
                WHERE game_pk IN ({placeholders}) AND batter_id IS NOT NULL
            )
            AND game_date IN (
                SELECT DISTINCT game_date FROM mlb.player_at_bats
                WHERE game_pk IN ({placeholders}) AND game_date IS NOT NULL
            )
        """)
            ).fetchall()
        )

    targets = [(b, d) for b, d in pairs if (b, d) not in existing]
    if not targets:
        log.info("trend_stats: all %d pairs already present.", len(pairs))
        return

    log.info(
        "trend_stats: computing %d (batter, date) rows (%d already present).", len(targets), len(pairs) - len(targets)
    )

    batter_ids = {int(b) for b, _ in targets}
    records = _compute_trend_stats_bulk(engine, batter_ids, targets)

    if not records:
        log.info("trend_stats: no data produced (all batters had zero prior games).")
        return

    _merge_trend_stats(engine, records)
    log.info("trend_stats: merged %d rows.", len(records))


def _merge_trend_stats(engine, records):
    """
    Stage computed trend rows into #stage_trend and MERGE into
    mlb.player_trend_stats on (batter_id, game_date).

    This is the incremental sibling of rebuild_trend_stats (which merges
    fully server-side): the nightly flush computes its rows in pandas via
    _compute_trend_stats_bulk and lands them here. This function was
    referenced but never defined - the incremental trend path crashed with
    NameError on every flush until 2026-07-03. Column lists are derived
    from the record dicts, which mirror the table shape (code-generated
    keys, never user input).
    """
    if not records:
        return
    df = pd.DataFrame(records)
    key_cols = ["batter_id", "game_date"]
    stat_cols = [c for c in df.columns if c not in key_cols]
    df = df.astype(object).where(pd.notnull(df), None)

    col_defs = ",\n                ".join(f"{c} FLOAT NULL" for c in stat_cols)
    insert_cols = ", ".join(key_cols + stat_cols)
    param_names = ", ".join(f":{c}" for c in key_cols + stat_cols)
    set_clause = ",\n                ".join(f"{c} = src.{c}" for c in stat_cols)
    src_cols = ", ".join(f"src.{c}" for c in key_cols + stat_cols)

    with engine.begin() as conn:
        conn.execute(text("IF OBJECT_ID('tempdb..#stage_trend') IS NOT NULL DROP TABLE #stage_trend"))
        conn.execute(
            text(f"""
            CREATE TABLE #stage_trend (
                batter_id INT NOT NULL,
                game_date DATE NOT NULL,
                {col_defs},
                PRIMARY KEY (batter_id, game_date)
            )
        """)
        )
        conn.execute(
            text(f"INSERT INTO #stage_trend ({insert_cols}) VALUES ({param_names})"),
            df.to_dict("records"),
        )
        conn.execute(
            text(f"""
            MERGE mlb.player_trend_stats AS tgt
            USING #stage_trend AS src
              ON tgt.batter_id = src.batter_id AND tgt.game_date = src.game_date
            WHEN MATCHED THEN UPDATE SET
                {set_clause},
                updated_at = SYSUTCDATETIME()
            WHEN NOT MATCHED THEN INSERT ({insert_cols}, updated_at)
            VALUES ({src_cols}, SYSUTCDATETIME());
        """)
        )


def rebuild_trend_stats(engine):
    """
    Standalone rebuilder for --rebuild-trend-stats mode. Rebuilds
    mlb.player_trend_stats from the full mlb.player_at_bats table.

    Set-based implementation: one SQL MERGE per chunk of 50 batters computes
    all (batter_id, game_date) rows entirely server-side via ROW_NUMBER() sliding
    windows. No per-row Python loop.

    Does NOT delete existing rows first. For a hard rebuild, truncate the table
    before running this, or use --rebuild-at-bats which rebuilds from upstream.
    """
    with engine.connect() as conn:
        batters = [
            row[0]
            for row in conn.execute(
                text("SELECT DISTINCT batter_id FROM mlb.player_at_bats WHERE batter_id IS NOT NULL ORDER BY batter_id")
            ).fetchall()
        ]

    log.info("rebuild-trend-stats: %d distinct batters.", len(batters))
    if not batters:
        return

    EXCL = (
        "'caught_stealing_2b','caught_stealing_3b','caught_stealing_home',"
        "'pickoff_1b','pickoff_2b','pickoff_caught_stealing_2b',"
        "'pickoff_caught_stealing_3b','pickoff_caught_stealing_home',"
        "'pickoff_error_1b','stolen_base_2b','wild_pitch'"
    )

    CHUNK = 50
    total_rows = 0
    for start in range(0, len(batters), CHUNK):
        chunk = batters[start : start + CHUNK]
        plist = ", ".join(str(b) for b in chunk)

        with engine.begin() as conn:
            rows_merged = conn.execute(
                text(f"""
                WITH game_stats AS (
                    SELECT
                        batter_id, game_date,
                        COUNT(*) AS pa,
                        SUM(CASE WHEN result_event_type NOT IN (
                            'walk','intent_walk','hit_by_pitch','sac_fly',
                            'sac_fly_double_play','sac_bunt','sac_bunt_double_play',
                            'catcher_interf'
                        ) THEN 1 ELSE 0 END) AS ab_cnt,
                        SUM(CASE WHEN result_event_type IN (
                            'single','double','triple','home_run') THEN 1 ELSE 0 END) AS hits,
                        SUM(CASE WHEN result_event_type IN (
                            'walk','intent_walk') THEN 1 ELSE 0 END) AS bbs,
                        SUM(CASE WHEN result_event_type IN (
                            'strikeout','strikeout_double_play') THEN 1 ELSE 0 END) AS ks,
                        SUM(CASE result_event_type
                            WHEN 'single' THEN 1 WHEN 'double' THEN 2
                            WHEN 'triple' THEN 3 WHEN 'home_run' THEN 4
                            ELSE 0 END) AS total_bases,
                        SUM(CASE WHEN result_event_type = 'home_run' THEN 1 ELSE 0 END) AS home_runs,
                        SUM(CASE WHEN hit_launch_speed IS NOT NULL THEN 1 ELSE 0 END) AS bbe,
                        SUM(ISNULL(CAST(hit_launch_speed AS FLOAT), 0)) AS ev_sum,
                        SUM(CASE WHEN hit_launch_speed >= 95 THEN 1 ELSE 0 END) AS hard_hit,
                        SUM(CASE WHEN hit_launch_speed >= 95 AND hit_launch_angle BETWEEN 8 AND 32
                            THEN 1 ELSE 0 END) AS barrels,
                        SUM(CASE WHEN hit_probability IS NOT NULL THEN 1 ELSE 0 END) AS xba_cnt,
                        SUM(ISNULL(CAST(hit_probability AS FLOAT), 0)) AS xba_sum
                    FROM mlb.player_at_bats
                    WHERE batter_id IN ({plist})
                      AND game_date IS NOT NULL
                      AND result_event_type NOT IN ({EXCL})
                    GROUP BY batter_id, game_date
                ),
                targets AS (
                    SELECT DISTINCT batter_id, game_date
                    FROM mlb.player_at_bats
                    WHERE batter_id IN ({plist}) AND game_date IS NOT NULL
                ),
                ranked AS (
                    SELECT
                        t.batter_id AS target_batter,
                        t.game_date AS target_date,
                        g.pa, g.ab_cnt, g.hits, g.bbs, g.ks,
                        g.total_bases, g.home_runs, g.bbe, g.ev_sum,
                        g.hard_hit, g.barrels, g.xba_cnt, g.xba_sum,
                        ROW_NUMBER() OVER (
                            PARTITION BY t.batter_id, t.game_date
                            ORDER BY g.game_date DESC
                        ) AS rn
                    FROM targets t
                    JOIN game_stats g
                        ON g.batter_id = t.batter_id
                       AND g.game_date < t.game_date
                ),
                windows AS (
                    SELECT
                        target_batter, target_date,
                        SUM(CASE WHEN rn<=10 THEN pa ELSE 0 END) AS w10_pa,
                        SUM(CASE WHEN rn<=10 THEN ab_cnt ELSE 0 END) AS w10_ab,
                        SUM(CASE WHEN rn<=10 THEN hits ELSE 0 END) AS w10_hits,
                        SUM(CASE WHEN rn<=10 THEN bbs ELSE 0 END) AS w10_bbs,
                        SUM(CASE WHEN rn<=10 THEN ks ELSE 0 END) AS w10_ks,
                        SUM(CASE WHEN rn<=10 THEN total_bases ELSE 0 END) AS w10_total_bases,
                        SUM(CASE WHEN rn<=10 THEN home_runs ELSE 0 END) AS w10_home_runs,
                        SUM(CASE WHEN rn<=10 THEN bbe ELSE 0 END) AS w10_bbe,
                        SUM(CASE WHEN rn<=10 THEN ev_sum ELSE 0 END) AS w10_ev_sum,
                        SUM(CASE WHEN rn<=10 THEN hard_hit ELSE 0 END) AS w10_hard_hit,
                        SUM(CASE WHEN rn<=10 THEN barrels ELSE 0 END) AS w10_barrels,
                        SUM(CASE WHEN rn<=10 THEN xba_cnt ELSE 0 END) AS w10_xba_cnt,
                        SUM(CASE WHEN rn<=10 THEN xba_sum ELSE 0 END) AS w10_xba_sum,
                        SUM(CASE WHEN rn<=30 THEN pa ELSE 0 END) AS w30_pa,
                        SUM(CASE WHEN rn<=30 THEN ab_cnt ELSE 0 END) AS w30_ab,
                        SUM(CASE WHEN rn<=30 THEN hits ELSE 0 END) AS w30_hits,
                        SUM(CASE WHEN rn<=30 THEN bbs ELSE 0 END) AS w30_bbs,
                        SUM(CASE WHEN rn<=30 THEN ks ELSE 0 END) AS w30_ks,
                        SUM(CASE WHEN rn<=30 THEN total_bases ELSE 0 END) AS w30_total_bases,
                        SUM(CASE WHEN rn<=30 THEN home_runs ELSE 0 END) AS w30_home_runs,
                        SUM(CASE WHEN rn<=30 THEN bbe ELSE 0 END) AS w30_bbe,
                        SUM(CASE WHEN rn<=30 THEN ev_sum ELSE 0 END) AS w30_ev_sum,
                        SUM(CASE WHEN rn<=30 THEN hard_hit ELSE 0 END) AS w30_hard_hit,
                        SUM(CASE WHEN rn<=30 THEN barrels ELSE 0 END) AS w30_barrels,
                        SUM(CASE WHEN rn<=30 THEN xba_cnt ELSE 0 END) AS w30_xba_cnt,
                        SUM(CASE WHEN rn<=30 THEN xba_sum ELSE 0 END) AS w30_xba_sum,
                        SUM(CASE WHEN rn<=60 THEN pa ELSE 0 END) AS w60_pa,
                        SUM(CASE WHEN rn<=60 THEN ab_cnt ELSE 0 END) AS w60_ab,
                        SUM(CASE WHEN rn<=60 THEN hits ELSE 0 END) AS w60_hits,
                        SUM(CASE WHEN rn<=60 THEN bbs ELSE 0 END) AS w60_bbs,
                        SUM(CASE WHEN rn<=60 THEN ks ELSE 0 END) AS w60_ks,
                        SUM(CASE WHEN rn<=60 THEN total_bases ELSE 0 END) AS w60_total_bases,
                        SUM(CASE WHEN rn<=60 THEN home_runs ELSE 0 END) AS w60_home_runs,
                        SUM(CASE WHEN rn<=60 THEN bbe ELSE 0 END) AS w60_bbe,
                        SUM(CASE WHEN rn<=60 THEN ev_sum ELSE 0 END) AS w60_ev_sum,
                        SUM(CASE WHEN rn<=60 THEN hard_hit ELSE 0 END) AS w60_hard_hit,
                        SUM(CASE WHEN rn<=60 THEN barrels ELSE 0 END) AS w60_barrels,
                        SUM(CASE WHEN rn<=60 THEN xba_cnt ELSE 0 END) AS w60_xba_cnt,
                        SUM(CASE WHEN rn<=60 THEN xba_sum ELSE 0 END) AS w60_xba_sum
                    FROM ranked
                    GROUP BY target_batter, target_date
                ),
                splits AS (
                    SELECT
                        t.batter_id,
                        t.game_date AS target_date,
                        SUM(CASE WHEN pbp.pitcher_hand_code='L' THEN 1 ELSE 0 END) AS vs_lhp_pa,
                        SUM(CASE WHEN pbp.pitcher_hand_code='L'
                                  AND ab.result_event_type IN ('single','double','triple','home_run')
                                  THEN 1 ELSE 0 END) AS vs_lhp_hits,
                        SUM(CASE WHEN pbp.pitcher_hand_code='L'
                                  AND ab.result_event_type IN ('double','triple','home_run')
                                  THEN 1 ELSE 0 END) AS vs_lhp_xbh,
                        SUM(CASE WHEN pbp.pitcher_hand_code='L'
                                  AND ab.result_event_type NOT IN (
                                    'walk','intent_walk','hit_by_pitch','sac_fly',
                                    'sac_fly_double_play','sac_bunt','sac_bunt_double_play',
                                    'catcher_interf'
                                  ) THEN 1 ELSE 0 END) AS vs_lhp_ab,
                        SUM(CASE WHEN pbp.pitcher_hand_code='L'
                                  AND ab.result_event_type IN ('strikeout','strikeout_double_play')
                                  THEN 1 ELSE 0 END) AS vs_lhp_so,
                        SUM(CASE WHEN pbp.pitcher_hand_code='L'
                                  AND ab.result_event_type = 'home_run'
                                  THEN 1 ELSE 0 END) AS vs_lhp_hr,
                        SUM(CASE WHEN pbp.pitcher_hand_code='L'
                                  AND ab.result_event_type IN ('sac_fly','sac_fly_double_play')
                                  THEN 1 ELSE 0 END) AS vs_lhp_sf,
                        SUM(CASE WHEN pbp.pitcher_hand_code='L'
                                  AND ab.hit_launch_speed IS NOT NULL THEN 1 ELSE 0 END) AS vs_lhp_bbe,
                        SUM(CASE WHEN pbp.pitcher_hand_code='L'
                                  THEN ISNULL(CAST(ab.hit_launch_speed AS FLOAT),0) ELSE 0 END) AS vs_lhp_ev_sum,
                        SUM(CASE WHEN pbp.pitcher_hand_code='L'
                                  AND ab.hit_launch_speed >= 95 THEN 1 ELSE 0 END) AS vs_lhp_hard_hit,
                        SUM(CASE WHEN pbp.pitcher_hand_code='L'
                                  AND ab.hit_probability IS NOT NULL THEN 1 ELSE 0 END) AS vs_lhp_xba_cnt,
                        SUM(CASE WHEN pbp.pitcher_hand_code='L'
                                  THEN ISNULL(CAST(ab.hit_probability AS FLOAT),0) ELSE 0 END) AS vs_lhp_xba_sum,
                        SUM(CASE WHEN pbp.pitcher_hand_code='R' THEN 1 ELSE 0 END) AS vs_rhp_pa,
                        SUM(CASE WHEN pbp.pitcher_hand_code='R'
                                  AND ab.result_event_type IN ('single','double','triple','home_run')
                                  THEN 1 ELSE 0 END) AS vs_rhp_hits,
                        SUM(CASE WHEN pbp.pitcher_hand_code='R'
                                  AND ab.result_event_type IN ('double','triple','home_run')
                                  THEN 1 ELSE 0 END) AS vs_rhp_xbh,
                        SUM(CASE WHEN pbp.pitcher_hand_code='R'
                                  AND ab.result_event_type NOT IN (
                                    'walk','intent_walk','hit_by_pitch','sac_fly',
                                    'sac_fly_double_play','sac_bunt','sac_bunt_double_play',
                                    'catcher_interf'
                                  ) THEN 1 ELSE 0 END) AS vs_rhp_ab,
                        SUM(CASE WHEN pbp.pitcher_hand_code='R'
                                  AND ab.result_event_type IN ('strikeout','strikeout_double_play')
                                  THEN 1 ELSE 0 END) AS vs_rhp_so,
                        SUM(CASE WHEN pbp.pitcher_hand_code='R'
                                  AND ab.result_event_type = 'home_run'
                                  THEN 1 ELSE 0 END) AS vs_rhp_hr,
                        SUM(CASE WHEN pbp.pitcher_hand_code='R'
                                  AND ab.result_event_type IN ('sac_fly','sac_fly_double_play')
                                  THEN 1 ELSE 0 END) AS vs_rhp_sf,
                        SUM(CASE WHEN pbp.pitcher_hand_code='R'
                                  AND ab.hit_launch_speed IS NOT NULL THEN 1 ELSE 0 END) AS vs_rhp_bbe,
                        SUM(CASE WHEN pbp.pitcher_hand_code='R'
                                  THEN ISNULL(CAST(ab.hit_launch_speed AS FLOAT),0) ELSE 0 END) AS vs_rhp_ev_sum,
                        SUM(CASE WHEN pbp.pitcher_hand_code='R'
                                  AND ab.hit_launch_speed >= 95 THEN 1 ELSE 0 END) AS vs_rhp_hard_hit,
                        SUM(CASE WHEN pbp.pitcher_hand_code='R'
                                  AND ab.hit_probability IS NOT NULL THEN 1 ELSE 0 END) AS vs_rhp_xba_cnt,
                        SUM(CASE WHEN pbp.pitcher_hand_code='R'
                                  THEN ISNULL(CAST(ab.hit_probability AS FLOAT),0) ELSE 0 END) AS vs_rhp_xba_sum,
                        SUM(CASE WHEN ab.is_top_inning=0 THEN 1 ELSE 0 END) AS home_pa,
                        SUM(CASE WHEN ab.is_top_inning=0
                                  AND ab.result_event_type IN ('single','double','triple','home_run')
                                  THEN 1 ELSE 0 END) AS home_hits,
                        SUM(CASE WHEN ab.is_top_inning=1 THEN 1 ELSE 0 END) AS away_pa,
                        SUM(CASE WHEN ab.is_top_inning=1
                                  AND ab.result_event_type IN ('single','double','triple','home_run')
                                  THEN 1 ELSE 0 END) AS away_hits
                    FROM targets t
                    JOIN mlb.player_at_bats ab
                        ON ab.batter_id = t.batter_id
                       AND ab.game_date < t.game_date
                       AND ab.result_event_type NOT IN ({EXCL})
                    JOIN mlb.play_by_play pbp
                        ON pbp.game_pk = ab.game_pk
                       AND pbp.at_bat_number = ab.at_bat_number
                       AND pbp.is_last_pitch = 1
                    GROUP BY t.batter_id, t.game_date
                )
                MERGE mlb.player_trend_stats AS tgt
                USING (
                    SELECT
                        w.target_batter AS batter_id,
                        w.target_date   AS game_date,
                        w.w10_pa, w.w10_ab, w.w10_hits,
                        CASE WHEN w.w10_pa>0 THEN ROUND(CAST(w.w10_hits AS FLOAT)/w.w10_pa,3) END AS w10_hit_rate,
                        CASE WHEN w.w10_pa>0 THEN ROUND(CAST(w.w10_bbs  AS FLOAT)/w.w10_pa,3) END AS w10_bb_rate,
                        CASE WHEN w.w10_pa>0 THEN ROUND(CAST(w.w10_ks   AS FLOAT)/w.w10_pa,3) END AS w10_k_rate,
                        w.w10_total_bases,
                        CASE WHEN w.w10_pa>0 THEN ROUND(CAST(w.w10_total_bases AS FLOAT)/w.w10_pa,3) END AS w10_tb_per_pa,
                        w.w10_home_runs,
                        CASE WHEN w.w10_bbe>0 THEN ROUND(w.w10_ev_sum/w.w10_bbe,1) END AS w10_avg_ev,
                        CASE WHEN w.w10_bbe>0 THEN ROUND(CAST(w.w10_hard_hit AS FLOAT)/w.w10_bbe,3) END AS w10_hard_hit_pct,
                        CASE WHEN w.w10_bbe>0 THEN ROUND(CAST(w.w10_barrels  AS FLOAT)/w.w10_bbe,3) END AS w10_barrel_pct,
                        CASE WHEN w.w10_xba_cnt>0 THEN ROUND((w.w10_xba_sum/w.w10_xba_cnt)/100.0,3) END AS w10_avg_xba,
                        w.w30_pa, w.w30_ab, w.w30_hits,
                        CASE WHEN w.w30_pa>0 THEN ROUND(CAST(w.w30_hits AS FLOAT)/w.w30_pa,3) END AS w30_hit_rate,
                        CASE WHEN w.w30_pa>0 THEN ROUND(CAST(w.w30_bbs  AS FLOAT)/w.w30_pa,3) END AS w30_bb_rate,
                        CASE WHEN w.w30_pa>0 THEN ROUND(CAST(w.w30_ks   AS FLOAT)/w.w30_pa,3) END AS w30_k_rate,
                        w.w30_total_bases,
                        CASE WHEN w.w30_pa>0 THEN ROUND(CAST(w.w30_total_bases AS FLOAT)/w.w30_pa,3) END AS w30_tb_per_pa,
                        w.w30_home_runs,
                        CASE WHEN w.w30_bbe>0 THEN ROUND(w.w30_ev_sum/w.w30_bbe,1) END AS w30_avg_ev,
                        CASE WHEN w.w30_bbe>0 THEN ROUND(CAST(w.w30_hard_hit AS FLOAT)/w.w30_bbe,3) END AS w30_hard_hit_pct,
                        CASE WHEN w.w30_bbe>0 THEN ROUND(CAST(w.w30_barrels  AS FLOAT)/w.w30_bbe,3) END AS w30_barrel_pct,
                        CASE WHEN w.w30_xba_cnt>0 THEN ROUND((w.w30_xba_sum/w.w30_xba_cnt)/100.0,3) END AS w30_avg_xba,
                        w.w60_pa, w.w60_ab, w.w60_hits,
                        CASE WHEN w.w60_pa>0 THEN ROUND(CAST(w.w60_hits AS FLOAT)/w.w60_pa,3) END AS w60_hit_rate,
                        CASE WHEN w.w60_pa>0 THEN ROUND(CAST(w.w60_bbs  AS FLOAT)/w.w60_pa,3) END AS w60_bb_rate,
                        CASE WHEN w.w60_pa>0 THEN ROUND(CAST(w.w60_ks   AS FLOAT)/w.w60_pa,3) END AS w60_k_rate,
                        w.w60_total_bases,
                        CASE WHEN w.w60_pa>0 THEN ROUND(CAST(w.w60_total_bases AS FLOAT)/w.w60_pa,3) END AS w60_tb_per_pa,
                        w.w60_home_runs,
                        CASE WHEN w.w60_bbe>0 THEN ROUND(w.w60_ev_sum/w.w60_bbe,1) END AS w60_avg_ev,
                        CASE WHEN w.w60_bbe>0 THEN ROUND(CAST(w.w60_hard_hit AS FLOAT)/w.w60_bbe,3) END AS w60_hard_hit_pct,
                        CASE WHEN w.w60_bbe>0 THEN ROUND(CAST(w.w60_barrels  AS FLOAT)/w.w60_bbe,3) END AS w60_barrel_pct,
                        CASE WHEN w.w60_xba_cnt>0 THEN ROUND((w.w60_xba_sum/w.w60_xba_cnt)/100.0,3) END AS w60_avg_xba,
                        s.vs_lhp_pa, s.vs_lhp_hits,
                        CASE WHEN s.vs_lhp_pa>0 THEN ROUND(CAST(s.vs_lhp_hits AS FLOAT)/s.vs_lhp_pa,3) END AS vs_lhp_hit_rate,
                        s.vs_lhp_xbh,
                        CASE WHEN s.vs_lhp_bbe>0 THEN ROUND(s.vs_lhp_ev_sum/s.vs_lhp_bbe,1) END AS vs_lhp_avg_ev,
                        CASE WHEN s.vs_lhp_bbe>0 THEN ROUND(CAST(s.vs_lhp_hard_hit AS FLOAT)/s.vs_lhp_bbe,3) END AS vs_lhp_hard_hit_pct,
                        CASE WHEN s.vs_lhp_xba_cnt>0 THEN ROUND((s.vs_lhp_xba_sum/s.vs_lhp_xba_cnt)/100.0,3) END AS vs_lhp_avg_xba,
                        CASE WHEN (s.vs_lhp_ab - s.vs_lhp_so - s.vs_lhp_hr + s.vs_lhp_sf) > 0
                             THEN ROUND(CAST(s.vs_lhp_hits - s.vs_lhp_hr AS FLOAT)
                                        /(s.vs_lhp_ab - s.vs_lhp_so - s.vs_lhp_hr + s.vs_lhp_sf),3) END AS vs_lhp_babip,
                        s.vs_rhp_pa, s.vs_rhp_hits,
                        CASE WHEN s.vs_rhp_pa>0 THEN ROUND(CAST(s.vs_rhp_hits AS FLOAT)/s.vs_rhp_pa,3) END AS vs_rhp_hit_rate,
                        s.vs_rhp_xbh,
                        CASE WHEN s.vs_rhp_bbe>0 THEN ROUND(s.vs_rhp_ev_sum/s.vs_rhp_bbe,1) END AS vs_rhp_avg_ev,
                        CASE WHEN s.vs_rhp_bbe>0 THEN ROUND(CAST(s.vs_rhp_hard_hit AS FLOAT)/s.vs_rhp_bbe,3) END AS vs_rhp_hard_hit_pct,
                        CASE WHEN s.vs_rhp_xba_cnt>0 THEN ROUND((s.vs_rhp_xba_sum/s.vs_rhp_xba_cnt)/100.0,3) END AS vs_rhp_avg_xba,
                        CASE WHEN (s.vs_rhp_ab - s.vs_rhp_so - s.vs_rhp_hr + s.vs_rhp_sf) > 0
                             THEN ROUND(CAST(s.vs_rhp_hits - s.vs_rhp_hr AS FLOAT)
                                        /(s.vs_rhp_ab - s.vs_rhp_so - s.vs_rhp_hr + s.vs_rhp_sf),3) END AS vs_rhp_babip,
                        s.home_pa, s.home_hits,
                        CASE WHEN s.home_pa>0 THEN ROUND(CAST(s.home_hits AS FLOAT)/s.home_pa,3) END AS home_hit_rate,
                        s.away_pa, s.away_hits,
                        CASE WHEN s.away_pa>0 THEN ROUND(CAST(s.away_hits AS FLOAT)/s.away_pa,3) END AS away_hit_rate
                    FROM windows w
                    LEFT JOIN splits s ON s.batter_id=w.target_batter AND s.target_date=w.target_date
                    WHERE w.w10_pa>0 OR w.w30_pa>0 OR w.w60_pa>0
                ) AS src ON tgt.batter_id=src.batter_id AND tgt.game_date=src.game_date
                WHEN MATCHED THEN UPDATE SET
                    w10_pa=src.w10_pa, w10_ab=src.w10_ab, w10_hits=src.w10_hits,
                    w10_hit_rate=src.w10_hit_rate, w10_bb_rate=src.w10_bb_rate, w10_k_rate=src.w10_k_rate,
                    w10_total_bases=src.w10_total_bases, w10_tb_per_pa=src.w10_tb_per_pa, w10_home_runs=src.w10_home_runs,
                    w10_avg_ev=src.w10_avg_ev, w10_hard_hit_pct=src.w10_hard_hit_pct, w10_barrel_pct=src.w10_barrel_pct, w10_avg_xba=src.w10_avg_xba,
                    w30_pa=src.w30_pa, w30_ab=src.w30_ab, w30_hits=src.w30_hits,
                    w30_hit_rate=src.w30_hit_rate, w30_bb_rate=src.w30_bb_rate, w30_k_rate=src.w30_k_rate,
                    w30_total_bases=src.w30_total_bases, w30_tb_per_pa=src.w30_tb_per_pa, w30_home_runs=src.w30_home_runs,
                    w30_avg_ev=src.w30_avg_ev, w30_hard_hit_pct=src.w30_hard_hit_pct, w30_barrel_pct=src.w30_barrel_pct, w30_avg_xba=src.w30_avg_xba,
                    w60_pa=src.w60_pa, w60_ab=src.w60_ab, w60_hits=src.w60_hits,
                    w60_hit_rate=src.w60_hit_rate, w60_bb_rate=src.w60_bb_rate, w60_k_rate=src.w60_k_rate,
                    w60_total_bases=src.w60_total_bases, w60_tb_per_pa=src.w60_tb_per_pa, w60_home_runs=src.w60_home_runs,
                    w60_avg_ev=src.w60_avg_ev, w60_hard_hit_pct=src.w60_hard_hit_pct, w60_barrel_pct=src.w60_barrel_pct, w60_avg_xba=src.w60_avg_xba,
                    vs_lhp_pa=src.vs_lhp_pa, vs_lhp_hits=src.vs_lhp_hits, vs_lhp_hit_rate=src.vs_lhp_hit_rate,
                    vs_lhp_xbh=src.vs_lhp_xbh, vs_lhp_avg_ev=src.vs_lhp_avg_ev,
                    vs_lhp_hard_hit_pct=src.vs_lhp_hard_hit_pct, vs_lhp_avg_xba=src.vs_lhp_avg_xba,
                    vs_lhp_babip=src.vs_lhp_babip,
                    vs_rhp_pa=src.vs_rhp_pa, vs_rhp_hits=src.vs_rhp_hits, vs_rhp_hit_rate=src.vs_rhp_hit_rate,
                    vs_rhp_xbh=src.vs_rhp_xbh, vs_rhp_avg_ev=src.vs_rhp_avg_ev,
                    vs_rhp_hard_hit_pct=src.vs_rhp_hard_hit_pct, vs_rhp_avg_xba=src.vs_rhp_avg_xba,
                    vs_rhp_babip=src.vs_rhp_babip,
                    home_pa=src.home_pa, home_hits=src.home_hits, home_hit_rate=src.home_hit_rate,
                    away_pa=src.away_pa, away_hits=src.away_hits, away_hit_rate=src.away_hit_rate,
                    updated_at=SYSUTCDATETIME()
                WHEN NOT MATCHED THEN INSERT (
                    batter_id, game_date,
                    w10_pa, w10_ab, w10_hits, w10_hit_rate, w10_bb_rate, w10_k_rate,
                    w10_total_bases, w10_tb_per_pa, w10_home_runs, w10_avg_ev, w10_hard_hit_pct, w10_barrel_pct, w10_avg_xba,
                    w30_pa, w30_ab, w30_hits, w30_hit_rate, w30_bb_rate, w30_k_rate,
                    w30_total_bases, w30_tb_per_pa, w30_home_runs, w30_avg_ev, w30_hard_hit_pct, w30_barrel_pct, w30_avg_xba,
                    w60_pa, w60_ab, w60_hits, w60_hit_rate, w60_bb_rate, w60_k_rate,
                    w60_total_bases, w60_tb_per_pa, w60_home_runs, w60_avg_ev, w60_hard_hit_pct, w60_barrel_pct, w60_avg_xba,
                    vs_lhp_pa, vs_lhp_hits, vs_lhp_hit_rate,
                    vs_lhp_xbh, vs_lhp_avg_ev, vs_lhp_hard_hit_pct, vs_lhp_avg_xba, vs_lhp_babip,
                    vs_rhp_pa, vs_rhp_hits, vs_rhp_hit_rate,
                    vs_rhp_xbh, vs_rhp_avg_ev, vs_rhp_hard_hit_pct, vs_rhp_avg_xba, vs_rhp_babip,
                    home_pa, home_hits, home_hit_rate,
                    away_pa, away_hits, away_hit_rate
                ) VALUES (
                    src.batter_id, src.game_date,
                    src.w10_pa, src.w10_ab, src.w10_hits, src.w10_hit_rate, src.w10_bb_rate, src.w10_k_rate,
                    src.w10_total_bases, src.w10_tb_per_pa, src.w10_home_runs, src.w10_avg_ev, src.w10_hard_hit_pct, src.w10_barrel_pct, src.w10_avg_xba,
                    src.w30_pa, src.w30_ab, src.w30_hits, src.w30_hit_rate, src.w30_bb_rate, src.w30_k_rate,
                    src.w30_total_bases, src.w30_tb_per_pa, src.w30_home_runs, src.w30_avg_ev, src.w30_hard_hit_pct, src.w30_barrel_pct, src.w30_avg_xba,
                    src.w60_pa, src.w60_ab, src.w60_hits, src.w60_hit_rate, src.w60_bb_rate, src.w60_k_rate,
                    src.w60_total_bases, src.w60_tb_per_pa, src.w60_home_runs, src.w60_avg_ev, src.w60_hard_hit_pct, src.w60_barrel_pct, src.w60_avg_xba,
                    src.vs_lhp_pa, src.vs_lhp_hits, src.vs_lhp_hit_rate,
                    src.vs_lhp_xbh, src.vs_lhp_avg_ev, src.vs_lhp_hard_hit_pct, src.vs_lhp_avg_xba, src.vs_lhp_babip,
                    src.vs_rhp_pa, src.vs_rhp_hits, src.vs_rhp_hit_rate,
                    src.vs_rhp_xbh, src.vs_rhp_avg_ev, src.vs_rhp_hard_hit_pct, src.vs_rhp_avg_xba, src.vs_rhp_babip,
                    src.home_pa, src.home_hits, src.home_hit_rate,
                    src.away_pa, src.away_hits, src.away_hit_rate
                );
            """)
            ).rowcount

        total_rows += rows_merged
        log.info(
            "rebuild-trend-stats: batters %d-%d of %d (%d rows merged).",
            start + 1,
            start + len(chunk),
            len(batters),
            rows_merged,
        )

    log.info("rebuild-trend-stats: done. %d total rows merged.", total_rows)


def ensure_table(engine):
    with engine.begin() as conn:
        conn.execute(text(DDL_CREATE))
        conn.execute(text(DDL_ALTER_DESCRIPTIONS))
        conn.execute(text(DDL_CREATE_PBP_INDEXES))
        conn.execute(text(DDL_CREATE_BOXSCORE_INDEXES))
        conn.execute(text(DDL_CREATE_AT_BATS))
        conn.execute(text(DDL_DROP_NAME_COLUMNS))
        conn.execute(text(DDL_CREATE_AT_BATS_INDEXES))
        conn.execute(text(DDL_CREATE_BVP))
        conn.execute(text(DDL_CREATE_BVP_INDEXES))
        conn.execute(text(DDL_CREATE_TREND_STATS))
        conn.execute(text(DDL_CREATE_TREND_STATS_INDEXES))
        conn.execute(text(DDL_CREATE_GAME_STATCAST))
        conn.execute(text(DDL_CREATE_GAME_STATCAST_INDEXES))
        conn.execute(text(DDL_ALTER_BVP_QUALITY))
        conn.execute(text(DDL_ALTER_TREND_PLATOON_QUALITY))
        conn.execute(text(DDL_CREATE_PATTERNS))
        conn.execute(text(DDL_CREATE_PATTERNS_INDEXES))
        conn.execute(text(DDL_CREATE_STREAK_STATE))
        conn.execute(text(DDL_CREATE_STREAK_STATE_INDEX))
        conn.execute(text(DDL_CREATE_STREAK_DIST))
    log.info(
        "mlb.play_by_play, mlb.player_at_bats, mlb.career_batter_vs_pitcher, "
        "mlb.player_trend_stats, mlb.player_game_statcast, and "
        "mlb.player_patterns tables ensured."
    )


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def safe_int(val):
    try:
        return int(val) if val is not None else None
    except (ValueError, TypeError):
        return None


def safe_float(val):
    try:
        s = str(val).strip()
        return float(s) if s not in ("", "None") else None
    except (ValueError, TypeError):
        return None


def safe_bool(val):
    """
    Return 1/0/None for BIT columns.
    FIX: added float to the isinstance check — the API sometimes returns
    numeric 0.0/1.0 for boolean fields, which SQL Server rejects as an
    invalid cast to BIT when sent as a Python float.
    """
    if val is None:
        return None
    if isinstance(val, (bool, int, float)):
        return 1 if val else 0
    if isinstance(val, str):
        return 1 if val.lower() in ("true", "1", "yes") else 0
    return None


def safe_datetime(val):
    """
    Parse ISO timestamp strings from the API into Python datetime objects.
    Returns None on any parse failure so the column lands as NULL rather
    than an unconverted string being implicitly cast by SQL Server.
    """
    if val is None:
        return None
    try:
        return pd.Timestamp(val).to_pydatetime()
    except Exception:
        return None


def trunc(val, max_len):
    if val is None:
        return None
    s = str(val)
    return s[:max_len] if len(s) > max_len else s


def fetch_game_json(game_pk, retries=3, pause=5):
    url = API_BASE.format(game_pk=game_pk)
    for attempt in range(1, retries + 1):
        try:
            resp = requests.get(url, timeout=30)
            resp.raise_for_status()
            return resp.json()
        except Exception as exc:
            log.warning("Fetch failed for game_pk %d (attempt %d/%d): %s", game_pk, attempt, retries, exc)
            if attempt < retries:
                time.sleep(pause)
    return None


def parse_play_by_play(game_json, game_pk, game_date):
    try:
        all_plays = game_json["liveData"]["plays"]["allPlays"]
    except (KeyError, TypeError):
        return []

    game_data = game_json.get("gameData", {})
    away_id = game_data.get("teams", {}).get("away", {}).get("id")
    home_id = game_data.get("teams", {}).get("home", {}).get("id")
    venue_id = game_data.get("venue", {}).get("id")

    rows = []

    for play in all_plays:
        about = play.get("about", {})
        matchup = play.get("matchup", {})
        result = play.get("result", {})
        credits = [c.get("credit") for c in play.get("credits", [])]

        is_top = about.get("isTopInning")
        at_bat_num = safe_int(about.get("atBatIndex", -1)) + 1 if about.get("atBatIndex") is not None else None
        batter_id = matchup.get("batter", {}).get("id")
        pitcher_id = matchup.get("pitcher", {}).get("id")
        team_id = away_id if is_top else home_id
        vs_team_id = home_id if is_top else away_id
        is_ab = 1 if "b_ab" in credits else 0
        is_pa = 1 if "b_pa" in credits else 0

        play_events = play.get("playEvents", [])
        max_index = max((e.get("index", -1) for e in play_events), default=-1)

        for event in play_events:
            play_id = event.get("playId")
            if play_id is None:
                continue

            ev_index = event.get("index")
            is_last = ev_index == max_index

            details = event.get("details", {})
            pitch_data = event.get("pitchData", {})
            hit_data = event.get("hitData", {})
            ctx = event.get("contextMetrics", {})
            count = event.get("count", {})

            rows.append(
                {
                    "play_event_id": f"{game_pk}-{at_bat_num}-{ev_index}",
                    "game_pk": game_pk,
                    "game_date": pd.Timestamp(game_date).date() if game_date else None,
                    "at_bat_number": at_bat_num,
                    "play_event_index": ev_index,
                    "inning": safe_int(about.get("inning")),
                    "is_top_inning": safe_bool(is_top),
                    "team_id": team_id,
                    "vs_team_id": vs_team_id,
                    "away_team_id": away_id,
                    "home_team_id": home_id,
                    "venue_id": venue_id,
                    "result_event_type": trunc(result.get("eventType"), 50) if is_last else None,
                    "result_description": trunc(result.get("description"), 1000) if is_last else None,
                    "result_rbi": safe_int(result.get("rbi")) if is_last else None,
                    "result_is_out": safe_bool(result.get("isOut")) if is_last else None,
                    "at_bat_is_complete": safe_bool(about.get("isComplete")) if is_last else None,
                    "at_bat_is_scoring_play": safe_bool(about.get("isScoringPlay")) if is_last else None,
                    "at_bat_has_out": safe_bool(about.get("hasOut")) if is_last else None,
                    "at_bat_end_time": safe_datetime(about.get("endTime")) if is_last else None,
                    "play_end_time": safe_datetime(play.get("playEndTime")) if is_last else None,
                    "is_at_bat": is_ab if is_last else None,
                    "is_plate_appearance": is_pa if is_last else None,
                    "batter_id": batter_id,
                    "batter_hand_code": trunc(matchup.get("batSide", {}).get("code"), 1),
                    "batter_split": trunc(matchup.get("splits", {}).get("batter"), 30),
                    "pitcher_id": pitcher_id,
                    "pitcher_hand_code": trunc(matchup.get("pitchHand", {}).get("code"), 1),
                    "pitcher_split": trunc(matchup.get("splits", {}).get("pitcher"), 30),
                    "play_id": trunc(play_id, 50),
                    "play_event_type": trunc(event.get("type"), 30),
                    "is_pitch": safe_bool(event.get("isPitch")),
                    "is_base_running_play": safe_bool(event.get("isBaseRunningPlay")),
                    "pitch_number": safe_int(event.get("pitchNumber")),
                    "pitch_call_code": trunc(
                        details.get("call", {}).get("code") if isinstance(details.get("call"), dict) else None, 5
                    ),
                    "pitch_type_code": trunc(
                        details.get("type", {}).get("code") if isinstance(details.get("type"), dict) else None, 5
                    ),
                    "play_event_description": trunc(details.get("description"), 1000),
                    "is_hit_into_play": safe_bool(details.get("isInPlay")),
                    "is_strike": safe_bool(details.get("isStrike")),
                    "is_ball": safe_bool(details.get("isBall")),
                    "is_out": safe_bool(details.get("isOut")),
                    "runner_going": safe_bool(details.get("runnerGoing")),
                    "count_balls_strikes": f"{count.get('balls', '')}-{count.get('strikes', '')}" if count else None,
                    "count_outs": safe_int(count.get("outs")),
                    "is_last_pitch": safe_bool(is_last),
                    "play_event_end_time": safe_datetime(event.get("endTime")),
                    "pitch_start_speed": safe_float(pitch_data.get("startSpeed")),
                    "pitch_end_speed": safe_float(pitch_data.get("endSpeed")),
                    "pitch_zone": safe_int(pitch_data.get("zone")),
                    "strike_zone_top": safe_float(pitch_data.get("strikeZoneTop")),
                    "strike_zone_bottom": safe_float(pitch_data.get("strikeZoneBottom")),
                    "hit_launch_speed": safe_float(hit_data.get("launchSpeed")),
                    "hit_launch_angle": safe_int(hit_data.get("launchAngle")),
                    "hit_total_distance": safe_int(hit_data.get("totalDistance")),
                    "hit_trajectory": trunc(hit_data.get("trajectory"), 30),
                    "hit_hardness": trunc(hit_data.get("hardness"), 20),
                    "hit_location": safe_int(hit_data.get("location")),
                    "hit_probability": safe_float(hit_data.get("hitProbability")),
                    "hit_bat_speed": safe_float(hit_data.get("batSpeed")),
                    "home_run_ballparks": safe_int(ctx.get("homeRunBallparks")),
                }
            )

    return rows


def flush(engine, rows):
    """
    Write accumulated rows directly to mlb.play_by_play via INSERT.
    All games in the batch are new (diffed before the loop), so MERGE is
    unnecessary. Direct INSERT with fast_executemany=True is ~10x faster.
    """
    df = pd.DataFrame(rows)
    df = df.astype(object).where(pd.notna(df), other=None)
    df.to_sql(
        "play_by_play",
        engine,
        schema="mlb",
        if_exists="append",
        index=False,
        chunksize=500,
        dtype=INSERT_DTYPES,
    )


def load_player_at_bats_for_games(engine, game_pks):
    """
    Materialize one-row-per-at-bat data from mlb.play_by_play into
    mlb.player_at_bats for the given game_pks.

    Skips any game_pk already present in mlb.player_at_bats so partial
    runs are self-healing. Same filter as the live Exit Velo query:
    is_last_pitch = 1 AND result_event_type IS NOT NULL.

    Batter and pitcher names are NOT stored here. The web layer joins
    mlb.players at read time.
    """
    if not game_pks:
        return

    game_pks = list(set(int(g) for g in game_pks))

    with engine.connect() as conn:
        existing = {row[0] for row in conn.execute(text("SELECT DISTINCT game_pk FROM mlb.player_at_bats")).fetchall()}

    target = [g for g in game_pks if g not in existing]
    if not target:
        log.info("at_bats: all %d games already materialized.", len(game_pks))
        return

    placeholders = ", ".join(str(g) for g in target)
    query = f"""
        SELECT
            CAST(p.game_pk AS VARCHAR(10)) + '-' + CAST(p.at_bat_number AS VARCHAR(10)) AS at_bat_id,
            p.game_pk,
            p.game_date,
            p.at_bat_number,
            p.inning,
            p.is_top_inning,
            p.batter_id,
            p.pitcher_id,
            p.result_event_type,
            p.result_description,
            p.result_rbi,
            p.hit_launch_speed,
            p.hit_launch_angle,
            p.hit_total_distance,
            p.hit_trajectory,
            p.hit_hardness,
            p.hit_probability,
            p.hit_bat_speed,
            p.home_run_ballparks,
            p.away_team_id,
            p.home_team_id
        FROM mlb.play_by_play p
        WHERE p.game_pk IN ({placeholders})
          AND p.is_last_pitch = 1
          AND p.result_event_type IS NOT NULL
        ORDER BY p.game_pk, p.at_bat_number
    """

    df = pd.read_sql(query, engine)
    if df.empty:
        log.info("at_bats: no completed at-bats found for %d games.", len(target))
        return

    df = df.astype(object).where(pd.notna(df), other=None)
    df.to_sql(
        "player_at_bats",
        engine,
        schema="mlb",
        if_exists="append",
        index=False,
        chunksize=500,
        dtype=AB_INSERT_DTYPES,
    )
    log.info(
        "at_bats: wrote %d rows across %d games (%d skipped as already present).",
        len(df),
        len(target),
        len(game_pks) - len(target),
    )


def rebuild_player_at_bats(engine):
    """
    Standalone materializer for --rebuild-at-bats mode. Runs the at-bats
    loader against every game_pk currently in mlb.play_by_play.

    Does NOT delete existing rows. If you want a full rebuild rather than
    a gap fill, manually DELETE FROM mlb.player_at_bats first.
    """
    with engine.connect() as conn:
        pbp_games = [row[0] for row in conn.execute(text("SELECT DISTINCT game_pk FROM mlb.play_by_play")).fetchall()]

    log.info("rebuild: %d distinct game_pks in mlb.play_by_play.", len(pbp_games))
    if not pbp_games:
        return

    CHUNK = 100
    for start in range(0, len(pbp_games), CHUNK):
        chunk = pbp_games[start : start + CHUNK]
        log.info("rebuild: processing games %d-%d of %d.", start + 1, start + len(chunk), len(pbp_games))
        load_player_at_bats_for_games(engine, chunk)


def load_player_game_statcast_for_games(engine, game_pks, force=False):
    """
    Materialize one-row-per-(batter, game) Statcast aggregates from
    mlb.player_at_bats into mlb.player_game_statcast for the given game_pks.

    Nightly path (force=False): same pattern as the at-bats materializer —
    pre-diff against existing game_pks (self-healing for partial runs), then
    a single set-based INSERT..SELECT. Source at-bat rows never change after
    load, so re-MERGE is unnecessary.

    Rebuild path (force=True): recompute the given games unconditionally —
    DELETE + re-INSERT inside one transaction. This matches the overwrite
    semantics of the sibling --rebuild-bvp / --rebuild-trend-stats modes,
    so a definition change (or a late-arriving box score) is healed by a
    rebuild dispatch instead of silently skipped.

    `runs` comes from mlb.batting_stats (scoring is not an at-bat outcome);
    it lands NULL when the box score row is absent — mlb-etl (09:00 UTC)
    runs before this workflow (09:30), so the box score is normally present.
    A force rebuild re-reads the box score and fills previously-NULL runs.

    Stat definitions (hard-hit EV>=95, barrel EV>=95 & LA 8-32, xba from
    hit_probability/100) match player_trend_stats and the web layer's
    statcastFormat.ts — keep them in lockstep.
    """
    if not game_pks:
        return

    game_pks = list(set(int(g) for g in game_pks))

    if force:
        target = game_pks
    else:
        with engine.connect() as conn:
            existing = {
                row[0] for row in conn.execute(text("SELECT DISTINCT game_pk FROM mlb.player_game_statcast")).fetchall()
            }
        target = [g for g in game_pks if g not in existing]

    if not target:
        log.info("game_statcast: all %d games already materialized.", len(game_pks))
        return

    placeholders = ", ".join(str(g) for g in target)
    EXCL = (
        "'caught_stealing_2b','caught_stealing_3b','caught_stealing_home',"
        "'pickoff_1b','pickoff_2b','pickoff_caught_stealing_2b',"
        "'pickoff_caught_stealing_3b','pickoff_caught_stealing_home',"
        "'pickoff_error_1b','stolen_base_2b','wild_pitch'"
    )

    # mlb.batting_stats is owned by mlb_etl.py and may not exist yet on an
    # empty DB (same reason DDL_CREATE_BOXSCORE_INDEXES guards on OBJECT_ID).
    # Referencing a missing table in the LEFT JOIN is a hard compile error,
    # so fall back to NULL runs when it is absent.
    with engine.connect() as conn:
        has_box = conn.execute(text("SELECT OBJECT_ID('mlb.batting_stats')")).scalar() is not None

    if has_box:
        runs_select = "bs.runs"
        # Grouped subquery, not a direct join: batter_game_id embeds team_id
        # (mlb_etl.py), so a player whose team attribution changed between
        # ETL runs has two box rows for one (game_pk, player_id). A direct
        # join fans out and violates PK_player_game_statcast (seen on the
        # first backfill at batter 643376 / game 746942).
        box_join = """
            LEFT JOIN (
                SELECT game_pk, player_id, MAX(runs) AS runs
                FROM mlb.batting_stats
                GROUP BY game_pk, player_id
            ) bs
                ON bs.game_pk = a.game_pk AND bs.player_id = a.batter_id"""
    else:
        runs_select = "CAST(NULL AS INT) AS runs"
        box_join = ""

    with engine.begin() as conn:
        # Materialize the at-bat slice into a temp table instead of a CTE.
        # A SELECT * CTE over a large IN list, referenced three times inside
        # an INSERT..SELECT, trips SQL Server optimizer error 8624 ("could
        # not produce a query plan") — seen on the first rebuild dispatch.
        # The temp table also matches the BvP staging pattern above.
        conn.execute(text("IF OBJECT_ID('tempdb..#gsc_ab') IS NOT NULL DROP TABLE #gsc_ab"))
        conn.execute(
            text(f"""
            SELECT batter_id, game_pk, game_date, at_bat_number, is_top_inning,
                   pitcher_id, result_event_type, result_rbi,
                   hit_launch_speed, hit_launch_angle, hit_total_distance,
                   hit_probability, away_team_id, home_team_id
            INTO #gsc_ab
            FROM mlb.player_at_bats
            WHERE game_pk IN ({placeholders})
              AND batter_id IS NOT NULL
              AND result_event_type NOT IN ({EXCL})
        """)
        )
        if force:
            conn.execute(text(f"DELETE FROM mlb.player_game_statcast WHERE game_pk IN ({placeholders})"))
        inserted = conn.execute(
            text(f"""
            WITH first_pa AS (
                SELECT batter_id, game_pk, MIN(at_bat_number) AS first_abn
                FROM #gsc_ab
                GROUP BY batter_id, game_pk
            ),
            agg AS (
                SELECT
                    ab.batter_id,
                    ab.game_pk,
                    MAX(ab.game_date) AS game_date,
                    MAX(CASE WHEN ab.is_top_inning=1 THEN ab.away_team_id ELSE ab.home_team_id END) AS team_id,
                    MAX(CASE WHEN ab.is_top_inning=1 THEN ab.home_team_id ELSE ab.away_team_id END) AS opp_team_id,
                    MAX(CASE WHEN ab.is_top_inning=0 THEN 1 ELSE 0 END) AS is_home,
                    COUNT(*) AS pa,
                    SUM(CASE WHEN ab.result_event_type NOT IN (
                        'walk','intent_walk','hit_by_pitch','sac_fly','sac_fly_double_play',
                        'sac_bunt','sac_bunt_double_play','catcher_interf'
                    ) THEN 1 ELSE 0 END) AS ab_cnt,
                    SUM(CASE WHEN ab.result_event_type IN ('single','double','triple','home_run')
                        THEN 1 ELSE 0 END) AS hits,
                    SUM(CASE WHEN ab.result_event_type = 'single'   THEN 1 ELSE 0 END) AS singles,
                    SUM(CASE WHEN ab.result_event_type = 'double'   THEN 1 ELSE 0 END) AS doubles,
                    SUM(CASE WHEN ab.result_event_type = 'triple'   THEN 1 ELSE 0 END) AS triples,
                    SUM(CASE WHEN ab.result_event_type = 'home_run' THEN 1 ELSE 0 END) AS home_runs,
                    SUM(CASE WHEN ab.result_event_type IN ('double','triple','home_run')
                        THEN 1 ELSE 0 END) AS xbh,
                    SUM(CASE ab.result_event_type
                        WHEN 'single' THEN 1 WHEN 'double' THEN 2
                        WHEN 'triple' THEN 3 WHEN 'home_run' THEN 4
                        ELSE 0 END) AS total_bases,
                    SUM(ISNULL(ab.result_rbi, 0)) AS rbi,
                    SUM(CASE WHEN ab.result_event_type IN ('strikeout','strikeout_double_play')
                        THEN 1 ELSE 0 END) AS strikeouts,
                    SUM(CASE WHEN ab.result_event_type IN ('walk','intent_walk')
                        THEN 1 ELSE 0 END) AS walks,
                    SUM(CASE WHEN ab.result_event_type = 'hit_by_pitch' THEN 1 ELSE 0 END) AS hit_by_pitch,
                    SUM(CASE WHEN ab.result_event_type IN ('sac_fly','sac_fly_double_play')
                        THEN 1 ELSE 0 END) AS sac_flies,
                    SUM(CASE WHEN ab.result_event_type = 'catcher_interf' THEN 1 ELSE 0 END) AS ci,
                    SUM(CASE WHEN ab.hit_launch_speed IS NOT NULL THEN 1 ELSE 0 END) AS bbe,
                    SUM(ISNULL(CAST(ab.hit_launch_speed AS FLOAT), 0)) AS ev_sum,
                    MAX(ab.hit_launch_speed) AS max_ev,
                    SUM(CASE WHEN ab.hit_launch_angle IS NOT NULL THEN 1 ELSE 0 END) AS la_cnt,
                    SUM(ISNULL(CAST(ab.hit_launch_angle AS FLOAT), 0)) AS la_sum,
                    SUM(CASE WHEN ab.hit_total_distance IS NOT NULL THEN 1 ELSE 0 END) AS dist_cnt,
                    SUM(ISNULL(CAST(ab.hit_total_distance AS FLOAT), 0)) AS dist_sum,
                    SUM(CASE WHEN ab.hit_probability IS NOT NULL THEN 1 ELSE 0 END) AS xba_cnt,
                    SUM(ISNULL(CAST(ab.hit_probability AS FLOAT), 0)) AS xba_sum,
                    SUM(CASE WHEN ab.hit_launch_speed >= 95 THEN 1 ELSE 0 END) AS hard_hit,
                    SUM(CASE WHEN ab.hit_launch_speed >= 95 AND ab.hit_launch_angle BETWEEN 8 AND 32
                        THEN 1 ELSE 0 END) AS barrels
                FROM #gsc_ab ab
                GROUP BY ab.batter_id, ab.game_pk
            )
            INSERT INTO mlb.player_game_statcast (
                batter_id, game_pk, game_date, team_id, opp_team_id, opp_pitcher_id, is_home,
                pa, ab, hits, singles, doubles, triples, home_runs, xbh, total_bases,
                runs, rbi, strikeouts, walks, hit_by_pitch, sac_flies, hip,
                bbe, ev_sum, avg_ev, max_ev,
                la_cnt, la_sum, avg_la,
                dist_cnt, dist_sum, avg_dist,
                xba_cnt, xba_sum, avg_xba,
                hard_hit, barrels
            )
            SELECT
                a.batter_id, a.game_pk, a.game_date, a.team_id, a.opp_team_id,
                fab.pitcher_id AS opp_pitcher_id,
                a.is_home,
                a.pa, a.ab_cnt, a.hits, a.singles, a.doubles, a.triples, a.home_runs,
                a.xbh, a.total_bases,
                {runs_select},
                a.rbi, a.strikeouts, a.walks, a.hit_by_pitch, a.sac_flies,
                a.pa - a.strikeouts - a.walks - a.hit_by_pitch - a.ci AS hip,
                a.bbe, a.ev_sum,
                CASE WHEN a.bbe > 0 THEN ROUND(a.ev_sum / a.bbe, 1) END AS avg_ev,
                a.max_ev,
                a.la_cnt, a.la_sum,
                CASE WHEN a.la_cnt > 0 THEN ROUND(a.la_sum / a.la_cnt, 1) END AS avg_la,
                a.dist_cnt, a.dist_sum,
                CASE WHEN a.dist_cnt > 0 THEN ROUND(a.dist_sum / a.dist_cnt, 1) END AS avg_dist,
                a.xba_cnt, a.xba_sum,
                CASE WHEN a.xba_cnt > 0 THEN ROUND((a.xba_sum / a.xba_cnt) / 100.0, 3) END AS avg_xba,
                a.hard_hit, a.barrels
            FROM agg a
            JOIN first_pa f
                ON f.batter_id = a.batter_id AND f.game_pk = a.game_pk
            JOIN #gsc_ab fab
                ON fab.batter_id = a.batter_id
               AND fab.game_pk = a.game_pk
               AND fab.at_bat_number = f.first_abn{box_join};
        """)
        ).rowcount
        conn.execute(text("DROP TABLE #gsc_ab"))

    log.info(
        "game_statcast: wrote %d rows across %d games (%d skipped as already present).",
        inserted,
        len(target),
        len(game_pks) - len(target),
    )


def rebuild_player_game_statcast(engine):
    """
    Standalone rebuilder for --rebuild-game-statcast mode. Recomputes
    mlb.player_game_statcast for every game_pk currently in
    mlb.player_at_bats — a true rebuild (force=True deletes and re-inserts
    each chunk), matching the overwrite semantics of --rebuild-bvp and
    --rebuild-trend-stats.
    """
    with engine.connect() as conn:
        ab_games = [row[0] for row in conn.execute(text("SELECT DISTINCT game_pk FROM mlb.player_at_bats")).fetchall()]

    log.info("rebuild-game-statcast: %d distinct game_pks in mlb.player_at_bats.", len(ab_games))
    if not ab_games:
        return

    CHUNK = 200
    for start in range(0, len(ab_games), CHUNK):
        chunk = ab_games[start : start + CHUNK]
        log.info(
            "rebuild-game-statcast: processing games %d-%d of %d.",
            start + 1,
            start + len(chunk),
            len(ab_games),
        )
        load_player_game_statcast_for_games(engine, chunk, force=True)


def _compute_pattern_rows(games_df, target_dates):
    """
    Compute mlb.player_patterns rows for ONE batter-season.

    games_df: that batter-season's player_game_statcast games as a DataFrame
    with game_date / game_pk / home_runs, any order. target_dates: the
    as-of dates to emit rows for (must be dates the batter played).

    Pure function over the game sequence so the incremental and rebuild
    paths cannot drift. Definitions documented at DDL_CREATE_PATTERNS.
    """
    g = games_df.sort_values(["game_date", "game_pk"]).reset_index(drop=True)
    hr_flags = (g["home_runs"].fillna(0) > 0).tolist()
    dates = g["game_date"].tolist()

    rows = []
    for as_of in sorted(set(target_dates)):
        n = max(i for i, d in enumerate(dates) if d <= as_of) + 1
        flags = hr_flags[:n]
        hr_seqs = [i for i, f in enumerate(flags) if f]

        games_since = (n - 1) - hr_seqs[-1] if hr_seqs else None

        samples = repeats = early = late = 0
        for i in hr_seqs:
            if i == n - 1:
                continue  # no subsequent game yet — not a sample
            samples += 1
            window = flags[i + 1 : i + 1 + PATTERN_WINDOW_GAMES]
            gap = next((j + 1 for j, f in enumerate(window) if f), None)
            if gap is not None:
                repeats += 1
                if gap <= PATTERN_EARLY_GAMES:
                    early += 1
                else:
                    late += 1

        rate = round(repeats / samples, 3) if samples else None
        hot = int(
            games_since is not None
            and games_since < PATTERN_WINDOW_GAMES
            and samples >= HR_HOT_MIN_SAMPLES
            and rate is not None
            and rate >= HR_HOT_MIN_RATE
        )
        rows.append(
            {
                "as_of_date": as_of,
                "season": as_of.year,
                "games_played": n,
                "hr_games": len(hr_seqs),
                "games_since_hr": games_since,
                "pattern_samples": samples,
                "pattern_repeats": repeats,
                "pattern_hit_rate": rate,
                "hr_pattern_early": round(early / repeats, 3) if repeats else None,
                "hr_pattern_late": round(late / repeats, 3) if repeats else None,
                "hr_hot": hot,
            }
        )
    return rows


def load_player_patterns_for_games(engine, game_pks):
    """
    Materialize mlb.player_patterns rows for the (batter, game_date) pairs
    touched by game_pks, from same-season mlb.player_game_statcast history.

    NO skip-if-pair-exists pre-diff, deliberately unlike the sibling
    loaders: a pattern row is through-date-INCLUSIVE, so when a
    doubleheader's games split across a flush boundary (or game 2 goes
    Final in a later run) the date's row must be recomputed with both
    games folded in — a pre-diff would skip it forever. The MERGE write
    makes unconditional recomputation idempotent, and the pair count per
    flush is small. The rebuild path reuses this same function.

    Runs AFTER load_player_game_statcast_for_games in the flush loop —
    patterns are a pure derivation of that table.
    """
    if not game_pks:
        return

    placeholders = ", ".join(str(int(g)) for g in set(game_pks))
    targets = pd.read_sql(
        text(f"""
        SELECT DISTINCT batter_id, CAST(game_date AS DATE) AS game_date
        FROM mlb.player_game_statcast
        WHERE game_pk IN ({placeholders}) AND game_date IS NOT NULL
    """),
        engine,
    )
    if targets.empty:
        log.info("player_patterns: no batter-date pairs for the given games.")
        return

    batter_ids = sorted(int(b) for b in targets["batter_id"].unique())
    seasons = sorted({d.year for d in targets["game_date"]})
    blist = ", ".join(str(b) for b in batter_ids)
    slist = ", ".join(str(s) for s in seasons)
    history = pd.read_sql(
        text(f"""
        SELECT batter_id, game_pk, CAST(game_date AS DATE) AS game_date, home_runs
        FROM mlb.player_game_statcast
        WHERE batter_id IN ({blist})
          AND YEAR(game_date) IN ({slist})
          AND game_date IS NOT NULL
    """),
        engine,
    )

    out = []
    targets_by_batter = targets.groupby("batter_id")["game_date"].apply(list)
    for batter_id, batter_games in history.groupby("batter_id"):
        t_dates = targets_by_batter.get(batter_id)
        if not t_dates:
            continue
        for season, season_games in batter_games.groupby(batter_games["game_date"].map(lambda d: d.year)):
            season_targets = [d for d in t_dates if d.year == season]
            if not season_targets:
                continue
            for row in _compute_pattern_rows(season_games, season_targets):
                out.append({"batter_id": int(batter_id), **row})

    if not out:
        log.info("player_patterns: nothing to write.")
        return

    # Stage into a temp table and MERGE, mirroring _merge_trend_stats — a
    # per-pair OR predicate would balloon on 200-game rebuild chunks.
    # Bind the record dicts directly: _compute_pattern_rows emits pure
    # Python ints/floats/None. A pandas round-trip floats the nullable int
    # columns (2.0), which pyodbc ships as varchar and SQL Server refuses
    # to cast to INT (error 245 on the first rebuild dispatch).
    cols = [
        "batter_id",
        "as_of_date",
        "season",
        "games_played",
        "hr_games",
        "games_since_hr",
        "pattern_samples",
        "pattern_repeats",
        "pattern_hit_rate",
        "hr_pattern_early",
        "hr_pattern_late",
        "hr_hot",
    ]
    insert_cols = ", ".join(cols)
    param_names = ", ".join(f":{c}" for c in cols)
    set_clause = ", ".join(f"{c} = src.{c}" for c in cols if c not in ("batter_id", "as_of_date"))
    src_cols = ", ".join(f"src.{c}" for c in cols)

    with engine.begin() as conn:
        conn.execute(text("IF OBJECT_ID('tempdb..#pp_stage') IS NOT NULL DROP TABLE #pp_stage"))
        conn.execute(
            text("""
            CREATE TABLE #pp_stage (
                batter_id        INT          NOT NULL,
                as_of_date       DATE         NOT NULL,
                season           INT          NOT NULL,
                games_played     INT          NULL,
                hr_games         INT          NULL,
                games_since_hr   INT          NULL,
                pattern_samples  INT          NULL,
                pattern_repeats  INT          NULL,
                -- FLOAT (not DECIMAL) in the stage, like #stage_trend:
                -- fast_executemany binds some float batches as varchar and
                -- SQL Server refuses varchar->numeric (8114, seen on the
                -- first rebuild dispatch); FLOAT accepts them and the MERGE
                -- converts to the target DECIMAL(5,3) server-side.
                pattern_hit_rate FLOAT        NULL,
                hr_pattern_early FLOAT        NULL,
                hr_pattern_late  FLOAT        NULL,
                hr_hot           INT          NOT NULL,
                PRIMARY KEY (batter_id, as_of_date)
            )
        """)
        )
        conn.execute(
            text(f"INSERT INTO #pp_stage ({insert_cols}) VALUES ({param_names})"),
            [{c: r[c] for c in cols} for r in out],
        )
        conn.execute(
            text(f"""
            MERGE mlb.player_patterns AS tgt
            USING #pp_stage AS src
              ON tgt.batter_id = src.batter_id AND tgt.as_of_date = src.as_of_date
            WHEN MATCHED THEN UPDATE SET {set_clause}
            WHEN NOT MATCHED THEN INSERT ({insert_cols})
            VALUES ({src_cols});
        """)
        )

    log.info(
        "player_patterns: wrote %d rows for %d batters; hr_hot on %d rows.",
        len(out),
        len(batter_ids),
        sum(r["hr_hot"] for r in out),
    )


def rebuild_player_patterns(engine):
    """
    Standalone rebuilder for --rebuild-patterns mode: recompute every
    (batter, date) pair currently in mlb.player_game_statcast, chunked by
    game_pk like the sibling rebuilders.
    """
    with engine.connect() as conn:
        games = [
            row[0] for row in conn.execute(text("SELECT DISTINCT game_pk FROM mlb.player_game_statcast")).fetchall()
        ]
    log.info("rebuild-patterns: %d distinct game_pks in mlb.player_game_statcast.", len(games))
    if not games:
        return

    CHUNK = 200
    for start in range(0, len(games), CHUNK):
        chunk = games[start : start + CHUNK]
        log.info(
            "rebuild-patterns: processing games %d-%d of %d.",
            start + 1,
            start + len(chunk),
            len(games),
        )
        load_player_patterns_for_games(engine, chunk)


# ---------------------------------------------------------------------------
# Streak / drought engine implementation
# ---------------------------------------------------------------------------


def _run_state_after(flags, i):
    """(state_type, length) of the run ENDING at game index i.

    flags[i] True  -> ('streak', length of trailing True run ending at i)
    flags[i] False -> ('drought', length of trailing False run ending at i)
    """
    val = flags[i]
    length = 0
    j = i
    while j >= 0 and flags[j] == val:
        length += 1
        j -= 1
    return ("streak" if val else "drought"), length


def _season_transitions(flags):
    """Accumulate within-season transition counts over one season's ordered
    event flags. For each game i (0..n-2): the run-state after game i, and
    whether the NEXT game (i+1) had the event.

    Returns (counts, ceiling) where counts[(state_type, length)] =
    [n_reached, n_event_next] and ceiling = the longest streak reached this
    season (0 if the player never had the event)."""
    counts = {}
    ceiling = 0
    n = len(flags)
    for i in range(n):
        st, ln = _run_state_after(flags, i)
        if st == "streak":
            ceiling = max(ceiling, ln)
        if i < n - 1:
            key = (st, ln)
            slot = counts.setdefault(key, [0, 0])
            slot[0] += 1
            if flags[i + 1]:
                slot[1] += 1
    return counts, ceiling


def _typical_gap(season_counts):
    """The drought length that most often preceded an event this season (mode
    of realized gaps), guarded by a minimum-sample floor. None if no eligible
    drought."""
    best_len = None
    best_hits = 0
    for (st, ln), (n_reached, n_next) in season_counts.items():
        if st != "drought" or n_reached < TYPICAL_GAP_MIN_SAMPLES:
            continue
        if n_next > best_hits:
            best_hits = n_next
            best_len = ln
    return best_len


def _compute_streak_rows(history_df, target_dates):
    """Compute player_streak_state rows (per as_of date, per market) and the
    latest-date player_streak_dist rows for ONE batter across all seasons.

    history_df: this batter's deduped per-game stats (game_date, game_pk,
    hits, runs, rbi, home_runs), any order, ALL seasons.
    target_dates: as-of dates to emit state rows for (dates the batter played).

    Pure over the game sequence so incremental and rebuild paths cannot drift.
    Run-state is within-season; career pools within-season transition counts.
    Returns (state_rows, dist_rows).
    """
    g = history_df.sort_values(["game_date", "game_pk"]).reset_index(drop=True)
    records = g.to_dict("records")
    dates = [r["game_date"] for r in records]
    seasons = [d.year for d in dates]

    # Per market, per season: ordered event flags with their game dates.
    flags_by_market_season = {}
    for mk, fn in STREAK_MARKETS.items():
        by_season = {}
        for rec, yr in zip(records, seasons):
            by_season.setdefault(yr, []).append((rec["game_date"], bool(fn(rec))))
        flags_by_market_season[mk] = by_season

    target_set = sorted(set(target_dates))
    max_target = target_set[-1] if target_set else None

    state_rows = []
    dist_rows = []

    for mk in STREAK_MARKETS:
        by_season = flags_by_market_season[mk]

        # Full per-season transition counts + ceilings, per season.
        season_full = {}  # year -> (counts, ceiling)
        for yr, pairs in by_season.items():
            flags = [f for _, f in sorted(pairs)]
            season_full[yr] = _season_transitions(flags)

        for as_of in target_set:
            yr = as_of.year
            pairs = sorted(by_season.get(yr, []))
            flags_through = [f for d, f in pairs if d <= as_of]
            if not flags_through:
                continue
            n = len(flags_through)

            # Current run-state after the as_of game (inclusive), within season.
            cur_type, cur_len = _run_state_after(flags_through, n - 1)

            # Season-scope transition counts THROUGH the as_of date only
            # (leakage: transitions after as_of must not inform this row).
            season_counts, season_ceiling = _season_transitions(flags_through)

            # Career-scope: this season's through-date counts + every PRIOR
            # season's full counts. Seasons AFTER the current one are future
            # data relative to this as-of date and must be excluded (they only
            # exist in the DB during a multi-season rebuild) — the earlier
            # "all other seasons" version leaked look-ahead into career_*.
            career_counts = {k: list(v) for k, v in season_counts.items()}
            career_ceiling = season_ceiling
            for oyr, (ocounts, oceil) in season_full.items():
                if oyr >= yr:
                    continue
                career_ceiling = max(career_ceiling, oceil)
                for k, (nr, nn) in ocounts.items():
                    slot = career_counts.setdefault(k, [0, 0])
                    slot[0] += nr
                    slot[1] += nn

            cur_key = (cur_type, cur_len)
            s_n, s_hits = season_counts.get(cur_key, [0, 0])
            c_n, c_hits = career_counts.get(cur_key, [0, 0])

            typical_gap = _typical_gap(season_counts)
            phase = None
            if cur_type == "drought" and typical_gap is not None:
                if cur_len < typical_gap:
                    phase = "early"
                elif cur_len == typical_gap:
                    phase = "on"
                else:
                    phase = "late"

            at_ceiling = int(cur_type == "streak" and cur_len >= max(season_ceiling, 1) and cur_len == season_ceiling)

            state_rows.append(
                {
                    "batter_id": None,  # filled by caller
                    "as_of_date": as_of,
                    "market": mk,
                    "season": yr,
                    "cur_state": cur_type if n > 0 else "none",
                    "cur_len": cur_len,
                    "streak_ceiling": season_ceiling,
                    "streak_ceiling_car": career_ceiling,
                    "typical_gap": typical_gap,
                    "phase": phase,
                    "at_ceiling": at_ceiling,
                    "season_n": s_n,
                    "season_hits": s_hits,
                    "season_freq": round(s_hits / s_n, 3) if s_n else None,
                    "career_n": c_n,
                    "career_hits": c_hits,
                    "career_freq": round(c_hits / c_n, 3) if c_n else None,
                }
            )

            # Distribution rows only for the latest as_of date (current curve).
            if as_of == max_target:
                for scope, counts in (("season", season_counts), ("career", career_counts)):
                    for (st, ln), (nr, nn) in counts.items():
                        if nr <= 0:
                            continue
                        dist_rows.append(
                            {
                                "batter_id": None,
                                "market": mk,
                                "scope": scope,
                                "state_type": st,
                                "state_len": ln,
                                "n_reached": nr,
                                "n_event_next": nn,
                                "freq": round(nn / nr, 3),
                                "as_of_date": as_of,
                            }
                        )

    return state_rows, dist_rows


def load_player_streaks_for_games(engine, game_pks):
    """Materialize mlb.player_streak_state (+ current-curve player_streak_dist)
    for the (batter, game_date) pairs touched by game_pks, from deduped
    mlb.batting_stats history across ALL seasons (career scope needs them).

    Like player_patterns: NO skip-if-exists (through-date-inclusive rows must
    recompute across doubleheader flush boundaries); MERGE makes it idempotent.
    Runs after the boxscore + at-bats are loaded.
    """
    if not game_pks:
        return

    placeholders = ", ".join(str(int(g)) for g in set(game_pks))
    targets = pd.read_sql(
        text(f"""
        SELECT DISTINCT player_id AS batter_id, CAST(game_date AS DATE) AS game_date
        FROM mlb.batting_stats
        WHERE game_pk IN ({placeholders}) AND game_date IS NOT NULL
    """),
        engine,
    )
    if targets.empty:
        log.info("player_streaks: no batter-date pairs for the given games.")
        return

    batter_ids = sorted(int(b) for b in targets["batter_id"].unique())
    blist = ", ".join(str(b) for b in batter_ids)
    # Deduped per-game batting line (max-PA row per game_pk+player_id), ALL
    # seasons for these batters (career scope). Same dedup as the props board.
    history = pd.read_sql(
        text(f"""
        SELECT batter_id, game_pk, game_date, hits, runs, rbi, home_runs
        FROM (
            SELECT b.player_id AS batter_id, b.game_pk,
                   CAST(b.game_date AS DATE) AS game_date,
                   b.hits, b.runs, b.rbi, b.home_runs,
                   ROW_NUMBER() OVER (PARTITION BY b.game_pk, b.player_id
                                      ORDER BY b.plate_appearances DESC) AS rn
            FROM mlb.batting_stats b
            WHERE b.player_id IN ({blist}) AND b.game_date IS NOT NULL
              -- Exclude pure non-batting appearances (pinch-run / defensive
              -- sub, 0 PA): the props board + transparency both filter these,
              -- so counting one as a no-event game would inflate droughts and
              -- diverge from "played" on those boards.
              AND (b.at_bats > 0 OR b.plate_appearances > 0)
        ) d
        WHERE d.rn = 1
    """),
        engine,
    )
    if history.empty:
        log.info("player_streaks: no batting history.")
        return

    targets_by_batter = targets.groupby("batter_id")["game_date"].apply(list)
    state_out = []
    dist_out = []
    for batter_id, bgames in history.groupby("batter_id"):
        t_dates = targets_by_batter.get(batter_id)
        if not t_dates:
            continue
        srows, drows = _compute_streak_rows(bgames, t_dates)
        for r in srows:
            r["batter_id"] = int(batter_id)
            state_out.append(r)
        for r in drows:
            r["batter_id"] = int(batter_id)
            dist_out.append(r)

    if state_out:
        _merge_streak_state(engine, state_out)
    if dist_out:
        # Delete-scope = only batters we are reinserting, NOT every touched
        # batter. A touched batter with no transitions this run (single game /
        # data gap) would otherwise have their prior curve wiped with nothing
        # to replace it.
        dist_batters = sorted({int(r["batter_id"]) for r in dist_out})
        _merge_streak_dist(engine, dist_out, dist_batters)
    log.info(
        "player_streaks: wrote %d state rows + %d dist rows for %d batters.",
        len(state_out),
        len(dist_out),
        len(batter_ids),
    )


def _merge_streak_state(engine, rows):
    cols = [
        "batter_id",
        "as_of_date",
        "market",
        "season",
        "cur_state",
        "cur_len",
        "streak_ceiling",
        "streak_ceiling_car",
        "typical_gap",
        "phase",
        "at_ceiling",
        "season_n",
        "season_hits",
        "season_freq",
        "career_n",
        "career_hits",
        "career_freq",
    ]
    key = ("batter_id", "as_of_date", "market")
    set_clause = ", ".join(f"{c} = src.{c}" for c in cols if c not in key)
    insert_cols = ", ".join(cols)
    src_cols = ", ".join(f"src.{c}" for c in cols)
    param_names = ", ".join(f":{c}" for c in cols)
    with engine.begin() as conn:
        conn.execute(text("IF OBJECT_ID('tempdb..#ss_stage') IS NOT NULL DROP TABLE #ss_stage"))
        conn.execute(
            text("""
            CREATE TABLE #ss_stage (
                batter_id INT NOT NULL, as_of_date DATE NOT NULL, market VARCHAR(8) NOT NULL,
                season INT NOT NULL, cur_state VARCHAR(8) NOT NULL, cur_len INT NOT NULL,
                streak_ceiling INT NULL, streak_ceiling_car INT NULL, typical_gap INT NULL,
                phase VARCHAR(8) NULL, at_ceiling INT NOT NULL,
                -- FLOAT staging for the DECIMAL targets (fast_executemany binds
                -- some float batches as varchar; SQL Server rejects varchar->numeric).
                season_n INT NULL, season_hits INT NULL, season_freq FLOAT NULL,
                career_n INT NULL, career_hits INT NULL, career_freq FLOAT NULL,
                PRIMARY KEY (batter_id, as_of_date, market)
            )
        """)
        )
        conn.execute(
            text(f"INSERT INTO #ss_stage ({insert_cols}) VALUES ({param_names})"),
            [{c: r[c] for c in cols} for r in rows],
        )
        conn.execute(
            text(f"""
            MERGE mlb.player_streak_state AS tgt
            USING #ss_stage AS src
              ON tgt.batter_id = src.batter_id AND tgt.as_of_date = src.as_of_date
                 AND tgt.market = src.market
            WHEN MATCHED THEN UPDATE SET {set_clause}
            WHEN NOT MATCHED THEN INSERT ({insert_cols}) VALUES ({src_cols});
        """)
        )


def _merge_streak_dist(engine, rows, batter_ids):
    """Replace the current curve for the processed batters (DELETE their rows,
    INSERT fresh) — player_streak_dist is latest-only, not per-as_of."""
    cols = [
        "batter_id",
        "market",
        "scope",
        "state_type",
        "state_len",
        "n_reached",
        "n_event_next",
        "freq",
        "as_of_date",
    ]
    insert_cols = ", ".join(cols)
    param_names = ", ".join(f":{c}" for c in cols)
    blist = ", ".join(str(int(b)) for b in batter_ids)
    with engine.begin() as conn:
        conn.execute(text("IF OBJECT_ID('tempdb..#sd_stage') IS NOT NULL DROP TABLE #sd_stage"))
        conn.execute(
            text("""
            CREATE TABLE #sd_stage (
                batter_id INT NOT NULL, market VARCHAR(8) NOT NULL, scope VARCHAR(8) NOT NULL,
                state_type VARCHAR(8) NOT NULL, state_len INT NOT NULL,
                n_reached INT NOT NULL, n_event_next INT NOT NULL, freq FLOAT NOT NULL,
                as_of_date DATE NOT NULL,
                PRIMARY KEY (batter_id, market, scope, state_type, state_len)
            )
        """)
        )
        conn.execute(
            text(f"INSERT INTO #sd_stage ({insert_cols}) VALUES ({param_names})"),
            [{c: r[c] for c in cols} for r in rows],
        )
        # Latest-only: clear the batters' existing curves, then insert fresh.
        conn.execute(text(f"DELETE FROM mlb.player_streak_dist WHERE batter_id IN ({blist})"))
        conn.execute(
            text(f"""
            INSERT INTO mlb.player_streak_dist ({insert_cols})
            SELECT {insert_cols} FROM #sd_stage;
        """)
        )


def rebuild_player_streaks(engine):
    """Standalone rebuilder for --rebuild-streaks: recompute every
    (batter, date) pair currently in mlb.batting_stats, chunked by game_pk."""
    with engine.connect() as conn:
        games = [row[0] for row in conn.execute(text("SELECT DISTINCT game_pk FROM mlb.batting_stats")).fetchall()]
    log.info("rebuild-streaks: %d distinct game_pks in mlb.batting_stats.", len(games))
    if not games:
        return
    CHUNK = 200
    for start in range(0, len(games), CHUNK):
        chunk = games[start : start + CHUNK]
        log.info("rebuild-streaks: processing games %d-%d of %d.", start + 1, start + len(chunk), len(games))
        load_player_streaks_for_games(engine, chunk)


# SQL expression that classifies a row from mlb.player_at_bats into at-bat
# count buckets. Reused by both the per-flush loader and the full rebuild.
# Event types follow the MLB Stats API contract observed in production data.
# Note: references unqualified "ab" alias; callers supply FROM mlb.player_at_bats AS ab.
BVP_AGGREGATE_SELECT = """
    ab.batter_id,
    ab.pitcher_id,
    COUNT(*) AS plate_appearances,
    SUM(CASE
        WHEN ab.result_event_type IN (
            'walk','intent_walk','hit_by_pitch','sac_fly','sac_fly_double_play',
            'sac_bunt','sac_bunt_double_play','catcher_interf'
        ) THEN 0 ELSE 1
    END) AS at_bats,
    SUM(CASE WHEN ab.result_event_type IN ('single','double','triple','home_run') THEN 1 ELSE 0 END) AS hits,
    SUM(CASE WHEN ab.result_event_type = 'single'   THEN 1 ELSE 0 END) AS singles,
    SUM(CASE WHEN ab.result_event_type = 'double'   THEN 1 ELSE 0 END) AS doubles,
    SUM(CASE WHEN ab.result_event_type = 'triple'   THEN 1 ELSE 0 END) AS triples,
    SUM(CASE WHEN ab.result_event_type = 'home_run' THEN 1 ELSE 0 END) AS home_runs,
    SUM(ISNULL(ab.result_rbi, 0)) AS rbi,
    SUM(CASE WHEN ab.result_event_type IN ('walk','intent_walk') THEN 1 ELSE 0 END) AS walks,
    SUM(CASE WHEN ab.result_event_type IN ('strikeout','strikeout_double_play') THEN 1 ELSE 0 END) AS strikeouts,
    SUM(CASE WHEN ab.result_event_type = 'hit_by_pitch' THEN 1 ELSE 0 END) AS hit_by_pitch,
    SUM(CASE WHEN ab.result_event_type IN ('sac_fly','sac_fly_double_play') THEN 1 ELSE 0 END) AS sac_flies,
    SUM(
        CASE WHEN ab.result_event_type = 'single'   THEN 1
             WHEN ab.result_event_type = 'double'   THEN 2
             WHEN ab.result_event_type = 'triple'   THEN 3
             WHEN ab.result_event_type = 'home_run' THEN 4
             ELSE 0 END
    ) AS total_bases,
    MAX(ab.game_date) AS last_faced_date,
    SUM(CASE WHEN ab.hit_launch_speed IS NOT NULL THEN 1 ELSE 0 END) AS bbe,
    SUM(ISNULL(CAST(ab.hit_launch_speed AS FLOAT), 0)) AS ev_sum,
    SUM(CASE WHEN ab.hit_launch_angle IS NOT NULL THEN 1 ELSE 0 END) AS la_cnt,
    SUM(ISNULL(CAST(ab.hit_launch_angle AS FLOAT), 0)) AS la_sum,
    SUM(CASE WHEN ab.hit_total_distance IS NOT NULL THEN 1 ELSE 0 END) AS dist_cnt,
    SUM(ISNULL(CAST(ab.hit_total_distance AS FLOAT), 0)) AS dist_sum,
    SUM(CASE WHEN ab.hit_probability IS NOT NULL THEN 1 ELSE 0 END) AS xba_cnt,
    SUM(ISNULL(CAST(ab.hit_probability AS FLOAT), 0)) AS xba_sum,
    SUM(CASE WHEN ab.hit_launch_speed >= 95 THEN 1 ELSE 0 END) AS hard_hit_ct,
    SUM(CASE WHEN ab.hit_launch_speed >= 95 AND ab.hit_launch_angle BETWEEN 8 AND 32
        THEN 1 ELSE 0 END) AS barrel_ct
"""


def _merge_bvp_from_temp(conn, temp_table):
    """
    MERGE a staging temp table (columns matching the permanent table shape)
    into mlb.career_batter_vs_pitcher. Called by both the incremental loader
    and the full rebuilder once staging is populated.
    """
    conn.execute(
        text(f"""
        MERGE mlb.career_batter_vs_pitcher AS tgt
        USING {temp_table} AS src
        ON tgt.batter_id = src.batter_id AND tgt.pitcher_id = src.pitcher_id
        WHEN MATCHED THEN UPDATE SET
            plate_appearances = src.plate_appearances,
            at_bats           = src.at_bats,
            hits              = src.hits,
            singles           = src.singles,
            doubles           = src.doubles,
            triples           = src.triples,
            home_runs         = src.home_runs,
            rbi               = src.rbi,
            walks             = src.walks,
            strikeouts        = src.strikeouts,
            hit_by_pitch      = src.hit_by_pitch,
            sac_flies         = src.sac_flies,
            total_bases       = src.total_bases,
            batting_avg       = CASE WHEN src.at_bats > 0
                                     THEN CAST(src.hits AS DECIMAL(10,4)) / src.at_bats
                                     ELSE NULL END,
            obp               = CASE WHEN (src.at_bats + src.walks + src.hit_by_pitch + src.sac_flies) > 0
                                     THEN CAST(src.hits + src.walks + src.hit_by_pitch AS DECIMAL(10,4))
                                        / (src.at_bats + src.walks + src.hit_by_pitch + src.sac_flies)
                                     ELSE NULL END,
            slg               = CASE WHEN src.at_bats > 0
                                     THEN CAST(src.total_bases AS DECIMAL(10,4)) / src.at_bats
                                     ELSE NULL END,
            ops               = CASE WHEN src.at_bats > 0
                                           AND (src.at_bats + src.walks + src.hit_by_pitch + src.sac_flies) > 0
                                     THEN (CAST(src.hits + src.walks + src.hit_by_pitch AS DECIMAL(10,4))
                                            / (src.at_bats + src.walks + src.hit_by_pitch + src.sac_flies))
                                        + (CAST(src.total_bases AS DECIMAL(10,4)) / src.at_bats)
                                     ELSE NULL END,
            last_faced_date   = src.last_faced_date,
            bbe               = src.bbe,
            avg_ev            = CASE WHEN src.bbe > 0
                                     THEN ROUND(src.ev_sum / src.bbe, 1) ELSE NULL END,
            avg_la            = CASE WHEN src.la_cnt > 0
                                     THEN ROUND(src.la_sum / src.la_cnt, 1) ELSE NULL END,
            avg_dist          = CASE WHEN src.dist_cnt > 0
                                     THEN ROUND(src.dist_sum / src.dist_cnt, 1) ELSE NULL END,
            avg_xba           = CASE WHEN src.xba_cnt > 0
                                     THEN ROUND((src.xba_sum / src.xba_cnt) / 100.0, 3) ELSE NULL END,
            hard_hit_ct       = src.hard_hit_ct,
            barrel_ct         = src.barrel_ct,
            updated_at        = SYSUTCDATETIME()
        WHEN NOT MATCHED THEN INSERT (
            batter_id, pitcher_id,
            plate_appearances, at_bats, hits,
            singles, doubles, triples, home_runs,
            rbi, walks, strikeouts, hit_by_pitch, sac_flies, total_bases,
            batting_avg, obp, slg, ops,
            last_faced_date,
            bbe, avg_ev, avg_la, avg_dist, avg_xba, hard_hit_ct, barrel_ct
        ) VALUES (
            src.batter_id, src.pitcher_id,
            src.plate_appearances, src.at_bats, src.hits,
            src.singles, src.doubles, src.triples, src.home_runs,
            src.rbi, src.walks, src.strikeouts, src.hit_by_pitch, src.sac_flies, src.total_bases,
            CASE WHEN src.at_bats > 0
                 THEN CAST(src.hits AS DECIMAL(10,4)) / src.at_bats
                 ELSE NULL END,
            CASE WHEN (src.at_bats + src.walks + src.hit_by_pitch + src.sac_flies) > 0
                 THEN CAST(src.hits + src.walks + src.hit_by_pitch AS DECIMAL(10,4))
                    / (src.at_bats + src.walks + src.hit_by_pitch + src.sac_flies)
                 ELSE NULL END,
            CASE WHEN src.at_bats > 0
                 THEN CAST(src.total_bases AS DECIMAL(10,4)) / src.at_bats
                 ELSE NULL END,
            CASE WHEN src.at_bats > 0
                       AND (src.at_bats + src.walks + src.hit_by_pitch + src.sac_flies) > 0
                 THEN (CAST(src.hits + src.walks + src.hit_by_pitch AS DECIMAL(10,4))
                        / (src.at_bats + src.walks + src.hit_by_pitch + src.sac_flies))
                    + (CAST(src.total_bases AS DECIMAL(10,4)) / src.at_bats)
                 ELSE NULL END,
            src.last_faced_date,
            src.bbe,
            CASE WHEN src.bbe > 0 THEN ROUND(src.ev_sum / src.bbe, 1) ELSE NULL END,
            CASE WHEN src.la_cnt > 0 THEN ROUND(src.la_sum / src.la_cnt, 1) ELSE NULL END,
            CASE WHEN src.dist_cnt > 0 THEN ROUND(src.dist_sum / src.dist_cnt, 1) ELSE NULL END,
            CASE WHEN src.xba_cnt > 0 THEN ROUND((src.xba_sum / src.xba_cnt) / 100.0, 3) ELSE NULL END,
            src.hard_hit_ct,
            src.barrel_ct
        );
    """)
    )


def load_career_bvp_for_games(engine, game_pks):
    """
    Recompute mlb.career_batter_vs_pitcher rows for every (batter_id,
    pitcher_id) pair that appears in the given game_pks.

    Unlike the at-bats materializer, this cannot use pre-diffed INSERT: a
    pair in this flush may already have a row from a previous flush and
    needs an UPDATE rather than an INSERT. Staged MERGE handles both.

    Steps:
      1. Stage the affected (batter, pitcher) pairs from player_at_bats
         where game_pk IN game_pks into #affected_pairs.
      2. Aggregate lifetime counts for those pairs across the full
         player_at_bats table via INNER JOIN to #affected_pairs into #stage_bvp.
      3. MERGE #stage_bvp into mlb.career_batter_vs_pitcher.

    SQL Server does not support tuple-IN syntax, so both staging tables
    carry their own compound PK and the second stage uses a JOIN rather
    than a (batter_id, pitcher_id) IN (...) predicate.
    """
    if not game_pks:
        return

    game_pks = list(set(int(g) for g in game_pks))
    placeholders = ", ".join(str(g) for g in game_pks)

    with engine.begin() as conn:
        conn.execute(
            text("""
            IF OBJECT_ID('tempdb..#affected_pairs') IS NOT NULL DROP TABLE #affected_pairs;
            IF OBJECT_ID('tempdb..#stage_bvp') IS NOT NULL DROP TABLE #stage_bvp;

            CREATE TABLE #affected_pairs (
                batter_id  INT NOT NULL,
                pitcher_id INT NOT NULL,
                PRIMARY KEY (batter_id, pitcher_id)
            );

            CREATE TABLE #stage_bvp (
                batter_id         INT NOT NULL,
                pitcher_id        INT NOT NULL,
                plate_appearances INT NOT NULL,
                at_bats           INT NOT NULL,
                hits              INT NOT NULL,
                singles           INT NOT NULL,
                doubles           INT NOT NULL,
                triples           INT NOT NULL,
                home_runs         INT NOT NULL,
                rbi               INT NOT NULL,
                walks             INT NOT NULL,
                strikeouts        INT NOT NULL,
                hit_by_pitch      INT NOT NULL,
                sac_flies         INT NOT NULL,
                total_bases       INT NOT NULL,
                last_faced_date   DATE NULL,
                bbe               INT NOT NULL,
                ev_sum            FLOAT NOT NULL,
                la_cnt            INT NOT NULL,
                la_sum            FLOAT NOT NULL,
                dist_cnt          INT NOT NULL,
                dist_sum          FLOAT NOT NULL,
                xba_cnt           INT NOT NULL,
                xba_sum           FLOAT NOT NULL,
                hard_hit_ct       INT NOT NULL,
                barrel_ct         INT NOT NULL,
                PRIMARY KEY (batter_id, pitcher_id)
            );
        """)
        )

        conn.execute(
            text(f"""
            INSERT INTO #affected_pairs (batter_id, pitcher_id)
            SELECT DISTINCT batter_id, pitcher_id
            FROM mlb.player_at_bats
            WHERE game_pk IN ({placeholders})
              AND batter_id IS NOT NULL
              AND pitcher_id IS NOT NULL;
        """)
        )

        conn.execute(
            text(f"""
            INSERT INTO #stage_bvp (
                batter_id, pitcher_id, plate_appearances, at_bats, hits,
                singles, doubles, triples, home_runs,
                rbi, walks, strikeouts, hit_by_pitch, sac_flies, total_bases,
                last_faced_date,
                bbe, ev_sum, la_cnt, la_sum, dist_cnt, dist_sum,
                xba_cnt, xba_sum, hard_hit_ct, barrel_ct
            )
            SELECT {BVP_AGGREGATE_SELECT}
            FROM mlb.player_at_bats AS ab
            INNER JOIN #affected_pairs AS ap
                ON ab.batter_id = ap.batter_id AND ab.pitcher_id = ap.pitcher_id
            WHERE ab.result_event_type NOT IN ({NON_PA_EVENTS_SQL})
            GROUP BY ab.batter_id, ab.pitcher_id;
        """)
        )

        result = conn.execute(text("SELECT COUNT(*) FROM #stage_bvp")).fetchone()
        staged = result[0] if result else 0
        if staged == 0:
            log.info("career_bvp: no pairs found for %d games.", len(game_pks))
            return

        _merge_bvp_from_temp(conn, "#stage_bvp")
        log.info("career_bvp: merged %d (batter, pitcher) pairs from %d games.", staged, len(game_pks))


def rebuild_career_bvp(engine):
    """
    Standalone rebuilder for --rebuild-bvp mode. Rebuilds
    mlb.career_batter_vs_pitcher from the full mlb.player_at_bats table.

    Chunked by batter_id to keep the staging temp table bounded. Each chunk
    aggregates a slice of batters against all pitchers they've faced, then
    merges.

    Does NOT delete existing rows. Because every chunk MERGEs on
    (batter_id, pitcher_id), stale rows for pairs that no longer appear
    in player_at_bats would remain. That case shouldn't occur in normal
    operation (player_at_bats only grows). For a hard rebuild, DELETE
    FROM mlb.career_batter_vs_pitcher first.
    """
    with engine.connect() as conn:
        batters = [
            row[0]
            for row in conn.execute(
                text("SELECT DISTINCT batter_id FROM mlb.player_at_bats WHERE batter_id IS NOT NULL ORDER BY batter_id")
            ).fetchall()
        ]

    log.info("rebuild-bvp: %d distinct batters in mlb.player_at_bats.", len(batters))
    if not batters:
        return

    CHUNK = 200
    total_pairs = 0
    for start in range(0, len(batters), CHUNK):
        chunk = batters[start : start + CHUNK]
        placeholders = ", ".join(str(b) for b in chunk)

        with engine.begin() as conn:
            conn.execute(
                text("""
                IF OBJECT_ID('tempdb..#stage_bvp') IS NOT NULL DROP TABLE #stage_bvp;
                CREATE TABLE #stage_bvp (
                    batter_id         INT NOT NULL,
                    pitcher_id        INT NOT NULL,
                    plate_appearances INT NOT NULL,
                    at_bats           INT NOT NULL,
                    hits              INT NOT NULL,
                    singles           INT NOT NULL,
                    doubles           INT NOT NULL,
                    triples           INT NOT NULL,
                    home_runs         INT NOT NULL,
                    rbi               INT NOT NULL,
                    walks             INT NOT NULL,
                    strikeouts        INT NOT NULL,
                    hit_by_pitch      INT NOT NULL,
                    sac_flies         INT NOT NULL,
                    total_bases       INT NOT NULL,
                    last_faced_date   DATE NULL,
                    bbe               INT NOT NULL,
                    ev_sum            FLOAT NOT NULL,
                    la_cnt            INT NOT NULL,
                    la_sum            FLOAT NOT NULL,
                    dist_cnt          INT NOT NULL,
                    dist_sum          FLOAT NOT NULL,
                    xba_cnt           INT NOT NULL,
                    xba_sum           FLOAT NOT NULL,
                    hard_hit_ct       INT NOT NULL,
                    barrel_ct         INT NOT NULL,
                    PRIMARY KEY (batter_id, pitcher_id)
                );
            """)
            )

            conn.execute(
                text(f"""
                INSERT INTO #stage_bvp (
                    batter_id, pitcher_id, plate_appearances, at_bats, hits,
                    singles, doubles, triples, home_runs,
                    rbi, walks, strikeouts, hit_by_pitch, sac_flies, total_bases,
                    last_faced_date,
                    bbe, ev_sum, la_cnt, la_sum, dist_cnt, dist_sum,
                    xba_cnt, xba_sum, hard_hit_ct, barrel_ct
                )
                SELECT {BVP_AGGREGATE_SELECT}
                FROM mlb.player_at_bats AS ab
                WHERE ab.batter_id IN ({placeholders})
                  AND ab.pitcher_id IS NOT NULL
                  AND ab.result_event_type NOT IN ({NON_PA_EVENTS_SQL})
                GROUP BY ab.batter_id, ab.pitcher_id;
            """)
            )

            result = conn.execute(text("SELECT COUNT(*) FROM #stage_bvp")).fetchone()
            staged = result[0] if result else 0
            total_pairs += staged

            if staged > 0:
                _merge_bvp_from_temp(conn, "#stage_bvp")

        log.info(
            "rebuild-bvp: batters %d-%d of %d (%d pairs merged this chunk).",
            start + 1,
            start + len(chunk),
            len(batters),
            staged,
        )

    log.info("rebuild-bvp: done. %d total pairs merged.", total_pairs)


# ---------------------------------------------------------------------------
# Main PBP fetch loop (concurrent HTTP, sequential DB writes)
# ---------------------------------------------------------------------------


def load_play_by_play(engine, seasons, batch_size):
    season_list = ", ".join(str(s) for s in seasons)
    with engine.connect() as conn:
        desired = [
            (row[0], row[1])
            for row in conn.execute(
                text(
                    f"""
                SELECT game_pk, game_date
                FROM mlb.games
                WHERE game_status = 'F'
                  AND game_type = 'R'
                  AND YEAR(game_date) IN ({season_list})
                ORDER BY game_date ASC
                """
                )
            ).fetchall()
        ]

    if not desired:
        log.info("No Final regular season games found in mlb.games for seasons %s.", seasons)
        return

    with engine.connect() as conn:
        existing = {row[0] for row in conn.execute(text("SELECT DISTINCT game_pk FROM mlb.play_by_play")).fetchall()}

    new_games = [(pk, gd) for pk, gd in desired if pk not in existing]
    log.info(
        "play_by_play: %d desired, %d existing, %d new. Processing oldest %d.",
        len(desired),
        len(existing),
        len(new_games),
        min(batch_size, len(new_games)),
    )

    if not new_games:
        log.info("No new PBP games to process.")
        return

    work = new_games[:batch_size]

    # Fetch all game JSONs concurrently, collect results in original order.
    log.info("Fetching %d games with %d workers.", len(work), FETCH_WORKERS)
    fetched = {}  # game_pk -> (game_json or None, game_date)

    with ThreadPoolExecutor(max_workers=FETCH_WORKERS) as executor:
        future_to_pk = {executor.submit(fetch_game_json, pk): (pk, gd) for pk, gd in work}
        for future in as_completed(future_to_pk):
            pk, gd = future_to_pk[future]
            try:
                fetched[pk] = (future.result(), gd)
            except Exception as exc:
                log.warning("game_pk %d fetch raised exception: %s", pk, exc)
                fetched[pk] = (None, gd)

    # Process in original game_date order for deterministic flush ordering.
    flush_rows = []
    flush_games = []

    for i, (game_pk, game_date) in enumerate(work, 1):
        game_json, _ = fetched.get(game_pk, (None, None))

        if game_json is None:
            log.warning("Skipping game_pk %d: no data returned.", game_pk)
            continue

        rows = parse_play_by_play(game_json, game_pk, game_date)
        if not rows:
            log.warning("game_pk %d: no play events parsed (postponed or no data).", game_pk)
            continue

        flush_rows.extend(rows)
        flush_games.append(game_pk)
        log.info("game_pk %d: %d events parsed (%d/%d).", game_pk, len(rows), i, len(work))

        if i % FLUSH_EVERY == 0 or i == len(work):
            flush(engine, flush_rows)
            log.info("Wrote %d PBP rows after game %d of %d.", len(flush_rows), i, len(work))
            load_player_at_bats_for_games(engine, flush_games)
            load_player_game_statcast_for_games(engine, flush_games)
            load_player_patterns_for_games(engine, flush_games)
            load_player_streaks_for_games(engine, flush_games)
            load_career_bvp_for_games(engine, flush_games)
            load_trend_stats_for_games(engine, flush_games)
            flush_rows = []
            flush_games = []

    log.info("play_by_play load complete.")


def main():
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("--batch", type=int, default=DEFAULT_BATCH)
    parser.add_argument("--seasons", type=int, nargs="+", default=None)
    parser.add_argument(
        "--rebuild-at-bats",
        action="store_true",
        help="Skip PBP fetch loop; rebuild mlb.player_at_bats from existing PBP data.",
    )
    parser.add_argument(
        "--rebuild-bvp",
        action="store_true",
        help="Skip PBP fetch loop; rebuild mlb.career_batter_vs_pitcher from existing player_at_bats data.",
    )
    parser.add_argument(
        "--rebuild-trend-stats",
        action="store_true",
        help="Skip PBP fetch loop; rebuild mlb.player_trend_stats from existing player_at_bats data.",
    )
    parser.add_argument(
        "--rebuild-game-statcast",
        action="store_true",
        help="Skip PBP fetch loop; rebuild mlb.player_game_statcast from existing player_at_bats data.",
    )
    parser.add_argument(
        "--rebuild-patterns",
        action="store_true",
        help="Skip PBP fetch loop; rebuild mlb.player_patterns from existing player_game_statcast data.",
    )
    parser.add_argument(
        "--rebuild-streaks",
        action="store_true",
        help="Skip PBP fetch loop; rebuild mlb.player_streak_state/dist from existing batting_stats data.",
    )
    args = parser.parse_args()

    seasons = args.seasons or SEASONS
    log.info("=== MLB Play-by-Play ETL started ===")
    log.info(
        "Seasons: %s  Batch: %d  Rebuild at-bats: %s  Rebuild BvP: %s  Rebuild trend: %s  Rebuild game-statcast: %s  Rebuild patterns: %s",
        seasons,
        args.batch,
        args.rebuild_at_bats,
        args.rebuild_bvp,
        args.rebuild_trend_stats,
        args.rebuild_game_statcast,
        args.rebuild_patterns,
    )

    engine = get_engine()
    ensure_table(engine)

    rebuild_mode = (
        args.rebuild_at_bats
        or args.rebuild_bvp
        or args.rebuild_trend_stats
        or args.rebuild_game_statcast
        or args.rebuild_patterns
        or args.rebuild_streaks
    )

    if rebuild_mode:
        if args.rebuild_at_bats:
            rebuild_player_at_bats(engine)
        if args.rebuild_game_statcast:
            rebuild_player_game_statcast(engine)
        if args.rebuild_patterns:
            rebuild_player_patterns(engine)
        if args.rebuild_streaks:
            rebuild_player_streaks(engine)
        if args.rebuild_bvp:
            rebuild_career_bvp(engine)
        if args.rebuild_trend_stats:
            rebuild_trend_stats(engine)
    else:
        load_play_by_play(engine, seasons, args.batch)

    log.info("=== MLB Play-by-Play ETL complete ===")


if __name__ == "__main__":
    main()
