# ADR-20260517-1: Hybrid bootstrap-vs-migrations strategy for database schemas

Date: 2026-05-17

## Context

sports-modeling treated `database/_shared/bootstrap.sql`, `database/nba/bootstrap.sql`, etc. as generated artifacts: produced on demand from the live SQL Server 2022 container via `INFORMATION_SCHEMA.COLUMNS` / `KEY_COLUMN_USAGE` / `sys.indexes`. The files used bare `CREATE TABLE` (not `IF NOT EXISTS`), so they could not be re-run against a populated database. The true DDL source-of-truth was scattered across the ETL and grading scripts (pandas `to_sql`, `ensure_tables()`, explicit `CREATE TABLE IF NOT EXISTS`). A single explicit migration file existed (`etl/mlb_batting_stats_migration.sql`), idempotency-guarded via `INFORMATION_SCHEMA.COLUMNS`, but it was the exception.

Two complaints surfaced during the schnapp-bet redesign:

1. "Regenerated bootstrap.sql is documentation, but it is committed as if it were truth." Reading it does not tell a maintainer what changed when.
2. "There is no migration system. Schema changes happen inline with code changes and rely on the ETL's own DDL to populate new structures in production." That is fine for sport tables (which barely change once shipped) but fragile for `common.*` tables (workflow_runs, grade_weights, daily_grades, ingest_quarantine, etc.), which change constantly under active grading work.

A single strategy (bootstrap everywhere OR migrations everywhere) imposes a one-size cost.

## Decision

Hybrid:

- **Sport schemas** (`nba`, `mlb`, `nfl`) — regenerate-on-demand from the live container. `database/<sport>/bootstrap.sql` is a generated artifact intended to recreate the schema against an empty database. A `--target-empty-db` guard on the generator script (`/tmp/gen_ddl.py`, regenerated from CHANGELOG history) asserts the output is bare `CREATE TABLE`; running it against a populated DB fails loudly, which is the intent. The committed file is documentation; it is not idempotent and is not designed to be.

- **Common schema** (`common.*`) — numbered idempotent migrations under `database/migrations/NNNN_short_slug.sql`. Each migration uses `IF NOT EXISTS` / `IF COL_LENGTH(...) IS NULL` guards on every DDL operation. Append-only. Applied locally first, verified, then committed; applied in production via a one-shot workflow or `shell_exec` script. The CHANGELOG entry that introduces a migration must list which consumers (web queries, grading scripts) were verified.

- **Procedure for both lives in** `.claude/skills/regenerate-bootstrap-sql/SKILL.md`. The skill decides which path the change takes ("must apply to existing rows" → migration; "defines what a new install looks like" → regenerated bootstrap).

## Consequences

- Two mental models for database evolution, but each fits its true change rate. Sport schemas are low-frequency and well-shaped; regenerate-on-demand is overhead-free. `common.*` is high-frequency and load-bearing; explicit migrations give a history and an apply-once guarantee.
- `database/migrations/` exists as a directory once the first `common.*` migration lands. Until then it is empty.
- `bootstrap.sql` files remain non-idempotent by design. The `--target-empty-db` flag is the safety check.
- The `regenerate-bootstrap-sql` skill is the only sanctioned entry point. Anyone hand-editing a `bootstrap.sql` file should be redirected to the skill or to a migration.
- This ADR is the first to land in the new repo and sets the precedent for the file format (`docs/decisions/ADR-YYYYMMDD-N-slug.md`) and the append-only discipline.

## Alternatives considered

- **Numbered migrations everywhere.** Uniform, but a sport-schema migration like "add NBA `daily_lineups`" is verbose when the table is a clean greenfield insert. Regenerate-from-live captures that in one mechanical step.
- **Regenerate everywhere.** Loses the audit trail on `common.*` changes that affect grading outputs. Migrations there are worth the friction.
- **External tool (sqitch, flyway, alembic).** Adds a runtime dependency for a deployment that already has none. Numbered SQL files with `IF EXISTS` guards are sufficient at current scale.
