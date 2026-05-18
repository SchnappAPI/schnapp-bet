---
name: new-sport-onboarding
description: Checklist for adding a fourth sport to the platform. Covers the database schema, ETL scripts, web app area, rule globs, workflow scaffolding, and CRITICAL_FIELDS additions. Use when adding the structural skeleton for a new sport before writing any code.
---

# New sport onboarding

The structure for NBA, MLB, and NFL is already in place. Adding a fourth sport (e.g., NHL, soccer, golf) is the same pattern repeated. This skill is the checklist.

## When to use this skill

- Adding the structural skeleton for a new sport.
- Reviewing whether an existing sport's structure is complete.

## Checklist

### 1. Database

- [ ] Create `database/<sport>/README.md` documenting the planned schema (tables, key columns, invariants).
- [ ] Create `database/<sport>/bootstrap.sql` after the schema is built in the live container (use `/skill regenerate-bootstrap-sql`).
- [ ] If the sport needs new shared tables (e.g., `common.player_value_lines` extended for a new market type), write a numbered migration under `database/migrations/`.

### 2. ETL

- [ ] Create `etl/<sport>/README.md` documenting the planned ETL design, data sources, and incremental strategy.
- [ ] When the ETL script lands, it goes at `etl/<sport>_etl.py` (flat layout per ADR-flat-etl). No subdirectories for code.
- [ ] Verify `.claude/rules/etl.md` `paths:` glob already matches `etl/**/*.py` — no change needed.

### 3. Grading

- [ ] If the sport needs its own model: `grading/<sport>_grade_props.py` with `MODEL_VERSION = "<sport>-v1.0"`.
- [ ] Add the sport's invariants to `.claude/rules/grading.md` (composite formula, KDE window, calibration thresholds).
- [ ] Verify `paths:` glob in `grading.md` covers any new workflow files.

### 4. Web

- [ ] Add `web/app/<sport>/` directory with `page.tsx`, `<sport>PageInner.tsx`, sport-specific routes.
- [ ] Add API routes under `web/app/api/` as needed.
- [ ] Update `.claude/rules/web.md` if the sport introduces a new invariant (e.g., a row-filter for the home page that excludes this sport).

### 5. Workflows

- [ ] `.github/workflows/<sport>-etl.yml` for the nightly ETL.
- [ ] `.github/workflows/<sport>-grading.yml` if the sport has its own grading job.
- [ ] Both must include `PYTHONPATH=/Users/schnapp/code/schnapp-bet` and run on `mac-runner`. `.claude/rules/workflows.md` enforces the rest.

### 6. Integrity

- [ ] Add the sport's tables to `shared/integrity.py` `CRITICAL_FIELDS` catalog with the required columns and `required_when` conditions.
- [ ] Add at least one `RELATIONAL_CHECKS` entry for the sport (e.g., `<sport>_games_stale`, `<sport>_player_count_sanity`).

### 7. Docs

- [ ] Update `docs/GLOSSARY.md` with a sport-specific section.
- [ ] Update `docs/PRODUCT_BLUEPRINT.md` if the sport changes any cross-sport assumption.
- [ ] Update `docs/ROADMAP.md` Active section.

### 8. Final

- [ ] Final commit subject tagged `[<sport>][shared]` documenting the onboarding (the commit subject is the changelog entry — ADR-20260517-4).
- [ ] ADR documenting any non-obvious decision (e.g., why this sport's grading model differs from NBA's).

## Anti-patterns

- Putting sport-specific code under `etl/<sport>/<script>.py`. ADR-flat-etl forbids this. All ETL code is flat in `etl/` root; sport subdirs are docs only.
- Adding the sport to a shared component (e.g., `web/components/PropMatrix.tsx`) before the per-sport area exists. Sport-specific stays under `web/app/<sport>/` until a cross-sport pattern emerges.
- Skipping `CRITICAL_FIELDS`. A sport with no integrity checks is a sport with no quality signal — production rows will silently drift.
