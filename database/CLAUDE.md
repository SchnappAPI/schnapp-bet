# database/CLAUDE.md

SQL Server 2022 running in Docker on Schnapps-MBP (Colima QEMU). Connection:
`localhost,1433`, SA credentials in `/Users/schnapp/sql-server.env`.

## Schema layout

- `common` schema: `daily_grades`, `player_tier_lines`, `player_value_lines`,
  `game_supplemental`, `workflow_runs`, `grade_weights`, `calibration_history`,
  `model_performance`, `ingest_quarantine`, `ingest_incomplete`, `ingest_health`.
- `nba` schema: `schedule`, `games`, `player_box_score_stats`, `daily_lineups`,
  `player_line_patterns`, `player_usage_stats`.
- `mlb` schema: `games`, `players`, `play_by_play`, `player_at_bats`,
  `career_batter_vs_pitcher`, `player_trend_stats`, `pitcher_season_stats`,
  `pitcher_game_logs`.
- `odds` schema: `upcoming_events`, `upcoming_player_props`, `player_props`,
  `event_game_map`, `player_map`.
- `nfl` schema: schedule and box scores. No downstream consumer yet.

## Bootstrap DDL

Generated files live in `database/_shared/bootstrap.sql`, `database/nba/bootstrap.sql`,
`database/mlb/bootstrap.sql`, `database/nfl/bootstrap.sql`. Regenerate with:
```
python /tmp/gen_ddl.py
```
using `SQL_*` env vars (not `AZURE_SQL_*`).

## Rules

- Never DROP TABLE without explicit confirmation. Prefer ADD COLUMN with a default or
  an idempotent ALTER.
- Schema changes that affect downstream consumers (web queries, grading scripts) require
  a note in the session's CHANGELOG entry listing which consumers were verified.
- Ad-hoc queries: write a script to `/tmp/` and run via Mac MCP shell_exec with
  `/Users/schnapp/venv/bin/python`. Do not run SQL directly from a session without a script.
- `common.workflow_runs` PK is `workflow_name`. One row per named workflow, updated on
  each completion. Do not add a date dimension to this table.
- `common.ingest_quarantine` rows are cleared by `validate_and_filter` on the next
  successful write pass. Do not manually delete quarantine rows.
