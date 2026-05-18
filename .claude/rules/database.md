---
paths:
  - "database/**"
---

- Never edit `bootstrap.sql` files by hand. They are generated from the live container. Use `/skill regenerate-bootstrap-sql`.
- Sport schemas (`nba`, `mlb`, `nfl`) regenerate-on-demand from the live DB with a `--target-empty-db` guard. Common schema (`common.*`) changes go in numbered, idempotent migrations under `database/migrations/NNNN_*.sql` (CREATE IF NOT EXISTS pattern). See ADR-bootstrap-strategy.
- Schema changes that affect downstream consumers (web queries, grading scripts) must list verified callers in the commit body. The commit subject names the schema change; the body enumerates which consumers were verified.
- Ad-hoc queries: write a script to `/tmp/` and run via Mac MCP `shell_exec` with `/Users/schnapp/venv/bin/python`. Do not run SQL directly from a session without a script.
- `common.workflow_runs` PK is `workflow_name`. One row per named workflow, updated on each completion. Do not add a date dimension to this table.
- `common.ingest_quarantine` rows are cleared by `validate_and_filter` on the next successful write pass. Do not manually delete quarantine rows.
- Never DROP TABLE without explicit confirmation. Prefer ADD COLUMN with a default or an idempotent ALTER.
- Bookmaker invariant: `bookmaker_key = 'fanduel'` on every odds-schema write. Multi-bookmaker support is deferred (ADR-0007 lineage).
- Schemas target the local SQL Server 2022 container at `localhost,1433` on Schnapps-MBP. SA credentials in `/Users/schnapp/sql-server.env`. Database name: `schnapp-bet`.
- BACPAC backups of the pre-migration Azure SQL `sports-modeling` database are retained at `/Users/schnapp/azure-sql-backups/` as portable restore points. Do not delete that directory.
