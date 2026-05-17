# etl/CLAUDE.md

Python ETL scripts that ingest raw data from external APIs into SQL Server. All runs via
GitHub Actions on mac-runner. No local execution.

## Structure

Scripts live flat in `etl/`. Sport-specific subfolders hold docs only.

- `nba_etl.py` — schedule, games, box scores, lineups, player stats.
- `mlb_etl.py` — games, players, play-by-play, trend stats.
- `mlb_play_by_play.py` — at-bats, career BvP, trend stats rebuild.
- `odds_etl.py` — upcoming events, props, player mappings. Runs in pipeline or backfill mode.
- `nfl_etl.py` — schedule and box scores. No downstream consumer yet.

## Rules

- Import `get_engine` from `shared.db`, never define a local engine factory.
- Import `validate_and_filter` from `shared.integrity` and wire it at every write site for
  tables in the CRITICAL_FIELDS scope. Tables not in scope pass through unchanged.
- `fast_executemany=True` (default). Do not override in ETL scripts.
- Incremental ingestion: determine what is already loaded by querying the destination table.
  Compute the delta in Python before making any API calls. Never truncate and reload unless
  explicitly rebuilding.
- When a single run loads multiple related tables, check existing keys against the most
  granular table only and treat all related tables as complete or incomplete together for
  that partition.
- Workflow env blocks must include:
  ```
  PYTHONPATH: /Users/schnapp/schnapp-bet
  SQL_SERVER: ${{ secrets.SQL_SERVER }}
  SQL_DATABASE: ${{ secrets.SQL_DATABASE }}
  SQL_USERNAME: ${{ secrets.SQL_USERNAME }}
  SQL_PASSWORD: ${{ secrets.SQL_PASSWORD }}
  SQL_TRUST_CERT: "yes"
  ```
- Never hardcode API keys, hostnames, or connection strings. Read from env or GitHub secrets.
- Odds API player mapping: unmapped players are not an error. Log and continue. Escalate
  to a GitHub Issue only at retry_count >= 3.
