# etl/mlb/

**STATUS:** live. Both scripts shipped in the 2026-05 code port and run on schedules.

## Scripts

All scripts at `etl/` root per ADR-20260420-1:

- `etl/mlb_etl.py` — nightly 7-table load: teams, schedule, players, games + batting_stats + pitching_stats, player_season_batting, pitcher_season_stats. Triggered by `.github/workflows/mlb-etl.yml` at 09:00 UTC.
- `etl/mlb_play_by_play.py` — pitch-level loader, nightly at 09:30 UTC since 2026-07-03 (previously `workflow_dispatch` only, which froze the derived tables mid-season). In-lockstep materializers for at-bats, career-BvP, player_trend_stats. Season derives from the current year; `--seasons` overrides.
- `grading/compute_mlb_projections.py` — batter context + per-market projections (ADR-0004 entities), run as an `mlb-grading.yml` step.

## Data sources

- **MLB Stats API** (`statsapi.mlb.com`) — public, no auth. Main game endpoint: `/api/v1/game/{gameID}/withMetrics` returns box scores, season stats, play-by-play, pitch data for a game.
- **Baseball Savant** (`baseballsavant.mlb.com`) — public. Source for Statcast pitch-level data and career BvP.

## Key design choices

- **Schema inference from API response** (not hand-written DDL). Pandas infers types on first run; subsequent runs use `add_missing_columns()` for ADD COLUMN drift.
- **Direct INSERT for append-only tables** (`mlb.play_by_play`, `mlb.player_at_bats`) — a sports-modeling-era decision (its ADR-0013; not renumbered here) carried forward. Staged MERGE for aggregate tables (`career_batter_vs_pitcher`, `player_trend_stats`).
- **Incremental checkpoint**: `mlb.batting_stats`. All three box-score tables fall together.
- **Month-by-month schedule fetch** (prevents 503s on wide date ranges).
- **`mlb.players` is MERGE/accumulate-across-seasons** per ADR-20260501-3, not truncate-and-reload.

## Invariants

- Use `shared.db.get_engine()` (or `get_engine_slow()` for long-VARCHAR staging like `mlb.play_by_play`).
- `mlb.players` writes use the `last_seen_season > tgt.last_seen_season` MERGE guard.
- Domain-conditional nulls in `play_by_play`: `is_hit_into_play = 0` → batted-ball columns NULL; pickoff/CS events → `batter_id` NULL.

See `.claude/rules/etl.md` for the auto-loaded ruleset.
