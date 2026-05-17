# shared/CLAUDE.md

Shared Python utilities imported by etl/ and grading/. Nothing here runs directly; it is
library code only.

## What lives here

- `db.py` — engine factory, `record_workflow_run(name)`.
- `integrity.py` — `validate_and_filter`, `generate_health_report`, integrity table DDL.

## Rules

- `get_engine()` reads `SQL_SERVER`, `SQL_DATABASE`, `SQL_USERNAME`, `SQL_PASSWORD`,
  `SQL_TRUST_CERT` from env. Never pass connection strings directly.
- `record_workflow_run(name)` builds its own engine internally. Call it as the last step
  of any workflow that writes data the UI displays.
- `fast_executemany` is True by default in `get_engine()`. Grading callers override it to
  False on their own engine call. ETL callers leave it at default.
- Every script importing from shared/ must have
  `PYTHONPATH: /Users/schnapp/schnapp-bet` in its workflow env block or the import will
  fail with ModuleNotFoundError.
- Do not add business logic here. db.py and integrity.py are infrastructure only.
- Do not duplicate get_engine in component packages. Import from shared.db everywhere.
