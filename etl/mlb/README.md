# etl/mlb/

**STATUS:** design phase in schnapp-bet (live in sports-modeling). ETL scripts land here in the code-port milestone.

## Planned scripts (carry over from sports-modeling)

All scripts at `etl/` root per ADR-20260420-1:

- `etl/mlb_etl.py` — nightly 7-table load: teams, schedule, players, games + batting_stats + pitching_stats, player_season_batting, pitcher_season_stats. Triggered by `.github/workflows/mlb-etl.yml` at 09:00 UTC.
- `etl/mlb_play_by_play.py` — on-demand pitch-level loader (`workflow_dispatch` only). In-lockstep materializers for at-bats, career-BvP, player_trend_stats.

## Data sources

- **MLB Stats API** (`statsapi.mlb.com`) — public, no auth. Main game endpoint: `/api/v1/game/{gameID}/withMetrics` returns box scores, season stats, play-by-play, pitch data for a game.
- **Baseball Savant** (`baseballsavant.mlb.com`) — public. Source for Statcast pitch-level data and career BvP.

## Key design choices

- **Schema inference from API response** (not hand-written DDL). Pandas infers types on first run; subsequent runs use `add_missing_columns()` for ADD COLUMN drift.
- **Direct INSERT for append-only tables** (`mlb.play_by_play`, `mlb.player_at_bats`) per ADR-0013 in sports-modeling. Staged MERGE for aggregate tables (`career_batter_vs_pitcher`, `player_trend_stats`).
- **Incremental checkpoint**: `mlb.batting_stats`. All three box-score tables fall together.
- **Month-by-month schedule fetch** (prevents 503s on wide date ranges).
- **`mlb.players` is MERGE/accumulate-across-seasons** per ADR-20260501-3, not truncate-and-reload.

## Invariants

- Use `shared.db.get_engine()` (or `get_engine_slow()` for long-VARCHAR staging like `mlb.play_by_play`).
- `mlb.players` writes use the `last_seen_season > tgt.last_seen_season` MERGE guard.
- Domain-conditional nulls in `play_by_play`: `is_hit_into_play = 0` → batted-ball columns NULL; pickoff/CS events → `batter_id` NULL.

See `.claude/rules/etl.md` for the auto-loaded ruleset.
