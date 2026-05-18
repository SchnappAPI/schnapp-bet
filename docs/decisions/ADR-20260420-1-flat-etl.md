# ADR-20260420-1: Code files stay flat in `etl/`; doc subfolders are additive only

Date: 2026-04-20

Legacy ID: ADR-0002.

## Context

The original documentation structure proposal included `/etl/nba/`, `/etl/mlb/`, `/etl/nfl/` as full subfolders containing both code and docs. The actual repo has `/etl/` as a flat directory with files like `etl/nba_etl.py`, `etl/mlb_etl.py`, `etl/nfl_etl.py`, `etl/odds_etl.py`. All sports-modeling GitHub Actions workflows referenced these files directly by their flat paths.

## Decision

Code files do not move. Per-sport documentation lives in additive subfolders alongside the existing flat code files: `etl/nba/README.md` exists in the same directory as `etl/nba_etl.py`. The subfolder is purely additive. The same approach applies to `web/`, `database/`, and (formerly) `infrastructure/` where similar flat layouts exist.

## Consequences

- Zero risk of breaking workflows or imports during the migration.
- Future code reorganization (for example, moving `etl/nba_etl.py` into `etl/nba/etl.py`) remains an option but is decoupled from the documentation work and would require updating workflow references in lockstep.
- Doc subfolders coexist with flat code files in the same directory listing. Visually unusual but functionally clean.
- `etl/_shared/` exists in sports-modeling as a README-only smell (documents extraction patterns but no Python). In schnapp-bet, drop it until extraction actually happens.
