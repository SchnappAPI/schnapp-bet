# Database

Area router for the schemas inside the `schnapp-bet` database. The canonical database is the **local SQL Server 2022 Docker container** at `localhost,1433` on Schnapps-MBP — target for all ETL and the production web tier. Connection details in `/docs/CONNECTIONS.md`.

## Schemas

- `nba` - NBA tables. STATUS: live. See `/database/nba/README.md`.
- `mlb` - MLB tables. STATUS: in development (7 nightly + 1 on-demand + 2 derived; 3 ADR-0004 entities remain). See `/database/mlb/README.md`.
- `nfl` - NFL tables. STATUS: idle (7 tables from nflreadpy; first run 2026-04-21; not in active use). See `/database/nfl/README.md`.
- `odds` - cross-sport odds tables. See `/database/_shared/README.md`.
- `common` - cross-sport utility tables (user codes, demo config, teams, patterns). See `/database/_shared/README.md`.

## Files

DDL currently lives inside Python ETL migration scripts under `/etl/` (for example, table-create logic inside `nba_etl.py` and `mlb_etl.py`, plus `db_inventory.py` which lists schemas and tables). Whether to introduce dedicated `.sql` DDL files per schema alongside the Python ETL is an open question (see Open Questions below); today, Python ETL is the source of truth for DDL.

## Key Concepts

Naming: schemas are lowercase (`nba`, `mlb`). Table and column names are snake_case. Primary keys are usually surrogate integers with a unique constraint on business keys.

## Invariants

- One database, five schemas.
- Schemas match sport names. Cross-sport data lives in `common` or `odds`.

## Recent Changes

See `/docs/CHANGELOG.md` filtered by `[database]`.

## Open Questions

Whether to introduce dedicated `.sql` DDL files per schema alongside the Python ETL, or continue with DDL-in-Python.
