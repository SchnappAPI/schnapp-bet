# Database

Area router for the schemas inside the `schnapp-bet` database. The canonical database is the **local SQL Server 2022 Docker container** at `localhost,1433` on Schnapps-MBP — target for all ETL and the production web tier. Connection details in `/docs/CONNECTIONS.md`.

## Schemas

- `nba` - NBA tables. STATUS: live. See `/database/nba/README.md`.
- `mlb` - MLB tables. STATUS: in development (7 nightly + 1 on-demand + 2 derived; 3 ADR-0004 entities remain). See `/database/mlb/README.md`.
- `nfl` - NFL tables. STATUS: idle (7 tables from nflreadpy; first run 2026-04-21; not in active use). See `/database/nfl/README.md`.
- `odds` - cross-sport odds tables. See `/database/_shared/README.md`.
- `common` - cross-sport utility tables (user codes, demo config, teams, patterns). See `/database/_shared/README.md`.

## Files

Each schema directory carries a generated `bootstrap.sql` full-schema snapshot (regenerate via `/skill regenerate-bootstrap-sql`; never hand-edit — see ADR-20260517-1). Runtime table-create/alter logic still lives in the Python ETL scripts (`nba_etl.py`, `mlb_etl.py`, `shared/integrity.py`'s `ensure_tables()`), so Python remains the source of truth for evolution; the snapshots are for rebuild-on-empty-DB and reference. `common.*` changes are supposed to go in numbered migrations under `database/migrations/` (per `.claude/rules/database.md`) — that directory does not exist yet.

## Key Concepts

Naming: schemas are lowercase (`nba`, `mlb`). Table and column names are snake_case. Primary keys are usually surrogate integers with a unique constraint on business keys.

## Invariants

- One database, five schemas.
- Schemas match sport names. Cross-sport data lives in `common` or `odds`.

## Recent Changes

Git log is the changelog (ADR-20260517-4): `git log --grep='\[database\]'`.

## Open Questions

The bootstrap-snapshot question is settled (ADR-20260517-1: regenerate sport schemas, migrate `common.*`). Still open: the numbered-migrations mechanism for `common.*` referenced by `.claude/rules/database.md` has no `database/migrations/` directory or runner yet.
