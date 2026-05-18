# ADR-20260402-1: Grading schema v3 — Over and Under rows with outcome_name in UNIQUE key

Date: 2026-04-02

Legacy ID: ADR-0005.

## Context

The original `common.daily_grades` schema stored one row per `(grade_date, event_id, player_id, market_key, bookmaker_key, line_value)` with an implicit Over orientation. Under grading was bolted on via a separate `best_price` CTE join at read time that tried to reattach Under prices at the web layer. That join was fragile and in practice attached Over prices to Under rows, so the At-a-Glance Under tab displayed wrong prices. Writing both directions into one row was rejected because the component-level grades (trend, momentum, pattern, matchup, regression) differ between Over and Under once inversion is applied.

## Decision

Migrate `common.daily_grades` to schema v3 which adds `outcome_name VARCHAR(5)` (`'Over'` / `'Under'`) and `over_price INT` (direction-appropriate price, misnamed but kept for migration simplicity). UNIQUE key extends to `(grade_date, event_id, player_id, market_key, bookmaker_key, line_value, outcome_name)`. `grade_props.py` writes both Over and Under rows for standard markets. Alternate lines remain Over-only. Web `getGrades` reads `dg.outcome_name` and `dg.over_price` directly from the table with no join to `odds`.

## Consequences

- Under tab in At a Glance shows correct prices.
- Row count per grading run roughly doubles for standard markets. Not a storage concern at current volume.
- The `over_price` column name is now a misnomer because it holds Under prices in Under rows. Rename deferred to avoid touching the grading engine and web routes simultaneously.
- The removed `best_price` CTE must not be reintroduced in any grading or reader query.
