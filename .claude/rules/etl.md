---
globs: "etl/**/*.py, .github/workflows/nba-*.yml, .github/workflows/mlb-*.yml,
  .github/workflows/nfl-*.yml, .github/workflows/odds-*.yml,
  .github/workflows/compute-*.yml, .github/workflows/backfill-*.yml"
---

- Import `get_engine` from `shared.db`. Never define a local engine factory.
- Import `validate_and_filter` from `shared.integrity` at every write site for tables in CRITICAL_FIELDS scope.
- `fast_executemany=True` (default). Do not override in ETL scripts.
- Incremental ingestion: query destination to find what is loaded, compute delta in Python, then call the API. Never truncate and reload unless explicitly rebuilding.
- When loading multiple related tables in one run, check existing keys against the most granular table only. Treat all related tables as complete or incomplete together for that partition.
- Unmapped Odds API players are not an error. Log and continue. Escalate to GitHub Issue only at retry_count >= 3.
- Workflow env block must include PYTHONPATH, SQL_SERVER, SQL_DATABASE, SQL_USERNAME, SQL_PASSWORD, SQL_TRUST_CERT.
