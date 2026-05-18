# database/

Schema definitions for the local SQL Server 2022 container (`localhost,1433`, database `sports-modeling`).

## Layout

- `_shared/` — `common` and `odds` schemas (cross-sport: grades, teams, integrity framework, workflow runs, odds lines). [Empty until bootstrap.sql lands in the next milestone.]
- `migrations/` — numbered, idempotent `IF NOT EXISTS` migrations for `common.*` changes. See `docs/decisions/ADR-20260517-1-bootstrap-strategy.md`. [Empty until first migration lands.]
- `nba/` — `nba` schema. See `nba/README.md`.
- `mlb/` — `mlb` schema. See `mlb/README.md`.
- `nfl/` — `nfl` schema. See `nfl/README.md`.

## bootstrap.sql vs migrations

Per ADR-20260517-1 hybrid strategy:

- **Sport schemas** regenerate-on-demand from the live container. `database/<sport>/bootstrap.sql` is a generated artifact intended to recreate the schema against an empty database. Not idempotent; not designed to be.
- **`common.*`** uses numbered migrations under `database/migrations/NNNN_*.sql`. Append-only, idempotent.

Procedure for either lives in `.claude/skills/regenerate-bootstrap-sql/SKILL.md` (`/skill regenerate-bootstrap-sql`).

## Connection

- Container `mssql`, port `localhost,1433`, database `sports-modeling`.
- Credentials: SA password in `/Users/schnapp/sql-server.env` (sourced by mac-runner workflows).
- See `docs/CONNECTIONS.md` for the full connection contract.

## Rules

See `.claude/rules/database.md` — auto-loaded when editing files under `database/`.
