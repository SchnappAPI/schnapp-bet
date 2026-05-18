---
paths:
  - "shared/**/*.py"
---

- `get_engine()` reads SQL_SERVER, SQL_DATABASE, SQL_USERNAME, SQL_PASSWORD, SQL_TRUST_CERT from env. Never pass connection strings directly. These come from the `Database` item in 1Password vault `web-variables`; invoke callers via `op run --env-file=.env.template -- ...` locally or via `1password/load-secrets-action` in workflows (per ADR-20260517-5).
- `record_workflow_run(name)` builds its own engine internally. It is the last call in any workflow that writes data the UI displays.
- `fast_executemany=True` is the default. Grading callers override to `False` explicitly. ETL callers leave it at default.
- Do not add business logic here. `db.py` and `integrity.py` are infrastructure only.
- Do not duplicate `get_engine` in component packages. Every script imports from `shared.db`.
