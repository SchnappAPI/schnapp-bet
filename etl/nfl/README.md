# etl/nfl/

**STATUS:** live foundation (2026-07-03; ADR-20260703-2). Weekly ETL green with offseason-aware season derivation, odds name-mapping implemented, integrity coverage on games/players/player_game_stats, and the `/nfl` web page consuming the tables. Grading lands when NFL odds flow (~September).

## Scripts

- `etl/nfl_etl.py` — 7-table complete ETL (games, players, player_game_stats, snap_counts, ftn_charting, rosters_weekly, team_game_stats). Triggered by `.github/workflows/nfl-etl.yml` Tuesday 09:00 UTC. Season flips in September; not-yet-published nflverse assets log SKIP instead of failing.
- `etl/odds_etl.py --mode mappings --sport nfl` — `_run_mappings_nfl`: 32-team name map, player map against `nfl.players` (full gsis string in `odds.player_map.gsis_id`), event↔game map on (date, home, away).

## Data source

- **nflverse via `nflreadpy`** — Python wrapper (`nflreadpy` 0.1.5). No hand-written API clients.
- `update_config(cache_mode='off')` at top of every ETL run (GitHub Actions runners have no persistent filesystem).

## Key design choices

- **Schema inference from API response** (not hand-written DDL). Pandas `to_sql(if_exists='replace')` first run; `add_missing_columns()` on subsequent runs. Drops/renames require manual intervention.
- **Fail-soft per table**: catches exceptions, logs, continues. Script exits 1 if any table failed but still attempts all others.
- **`clean_df()` global cleanup**: replace empty strings with None, coerce boolean-like objects, coerce ≥90% numeric object columns.
- **`get_engine` consolidated** from local duplicate to `from shared.db import get_engine` per ADR-20260501-3 (Initiative B).

See `.claude/rules/etl.md` for the auto-loaded ruleset.

## Open questions

- **NFL grading** — `nfl_grade_props.py` is contracted in ADR-20260703-2 (weekly keys, gsis settlement, TD markets as binary); implement at first live NFL odds.
- **Per-game web detail** — the week slate + player stats shipped; a per-game detail page is the next web layer.
