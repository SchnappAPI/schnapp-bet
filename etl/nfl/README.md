# etl/nfl/

**STATUS:** idle. ETL pipeline exists in sports-modeling; no active development, no downstream web consumer. Ports to schnapp-bet only when NFL web work resumes.

## Planned script (carry over from sports-modeling)

- `etl/nfl_etl.py` — 7-table complete ETL (games, players, player_game_stats, snap_counts, ftn_charting, rosters_weekly, team_game_stats). Triggered by `.github/workflows/nfl-etl.yml` Tuesday 09:00 UTC.

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

- **NFL web surface** — no web layer yet. Parallel design session like the MLB visual catalog: identify what visuals matter, what stats feed them, what the pre-aggregation layer needs.
- **NFL odds ingestion** — `odds_etl.py` reportedly mentions NFL sport keys but is unverified. Decide whether to extend it or add a dedicated `nfl_odds_etl.py`.
