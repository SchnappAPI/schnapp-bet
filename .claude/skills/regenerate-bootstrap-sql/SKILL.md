---
name: regenerate-bootstrap-sql
description: Re-sync database/_shared/bootstrap.sql and database/{nba,mlb,nfl}/bootstrap.sql from the live SQL Server 2022 container. Use when schema has changed and the checked-in DDL needs to match. Sport schemas regenerate-on-empty-DB with a guard; common.* changes go in numbered migrations instead.
---

# Regenerate bootstrap.sql

The `database/` bootstrap files are generated, not hand-written. The true DDL source-of-truth is the live SQL Server 2022 container at `localhost,1433` on Schnapps-MBP. This skill regenerates them.

## When to use this skill

- A new column was added to a sport schema and `database/nba/bootstrap.sql` (or mlb/nfl) is stale.
- A new sport schema was added.
- The `common.*` schema has a new table or column.

## Decision: regenerate or migrate?

Per ADR-bootstrap-strategy:

- **Sport schemas** (`nba`, `mlb`, `nfl`): regenerate-on-empty-DB. The bootstrap file is generated from the live container's `INFORMATION_SCHEMA` and is intended to recreate the schema against an empty DB. It is documentation, not a migration script.
- **`common.*` schema**: numbered migrations under `database/migrations/NNNN_*.sql`. Each migration is idempotent (`IF NOT EXISTS` / `IF NOT EXISTS … ELSE` guards). Append-only.

If unsure, the rule of thumb: if the change must apply to existing rows in production, it is a migration. If the change defines what a new install looks like, it is a regenerated bootstrap.

## Procedure: regenerate a sport bootstrap

1. Ensure the live container has the new schema. Run the relevant ETL or migration against `localhost,1433` first.
2. Run the generator script `database/_shared/gen_ddl.py` (checked in since 2026-07-04; the old `/tmp/gen_ddl.py` copy was lost to a reboot's tmp wipe).

```bash
SQL_PASS=$(grep MSSQL_SA_PASSWORD /Users/schnapp/sql-server.env | cut -d= -f2)
SQL_SERVER="localhost,1433" SQL_DATABASE="schnapp-bet" \
SQL_USERNAME="sa" SQL_PASSWORD="$SQL_PASS" \
SQL_TARGET_SCHEMA="nba" \
/Users/schnapp/venv/bin/python /Users/schnapp/code/schnapp-bet/database/_shared/gen_ddl.py --target-empty-db
```

The `--target-empty-db` flag asserts the script will emit bare `CREATE TABLE` (not `IF NOT EXISTS`). Running these against a populated DB would fail loudly, which is what we want.

3. Diff the output against the existing `database/<sport>/bootstrap.sql`. Inspect for surprise changes (a column dropped because the ETL stopped writing it, for example).
4. Commit. Subject format: `chore: [database][<sport>] regenerate bootstrap.sql from live container`.

## Procedure: write a new common.\* migration

1. Determine the next migration number: `ls database/migrations/ | tail -1` and increment.
2. Create `database/migrations/NNNN_short_slug.sql`. Use `IF NOT EXISTS` guards on every DDL operation. Example:

```sql
-- 0017_add_calibration_horizon_to_grade_weights.sql
IF COL_LENGTH('common.grade_weights', 'horizon_days') IS NULL
BEGIN
  ALTER TABLE common.grade_weights ADD horizon_days INT NULL;
END
```

3. Apply against the local container manually first, verify, then commit. Subject: `feat: [database][common] <slug> — migration NNNN`.
4. Apply in production via a one-shot workflow or `shell_exec` script. The production application is its own commit (e.g., `chore: [database][common][infra] apply migration NNNN to prod`).
5. `common.*` changes that affect downstream consumers (web queries, grading scripts) must list verified callers in the commit body.

## Anti-patterns

- Editing bootstrap.sql by hand. Always regenerate.
- Migrations that are not idempotent. Migrations get re-applied during disaster recovery; non-idempotent migrations break that.
- Dropping or renaming columns in a migration without a deprecation cycle.
