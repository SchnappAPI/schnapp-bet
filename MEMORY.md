# MEMORY.md

## Current Focus
Code port underway. `shared/db.py`, `shared/integrity.py`, and `services/flask/runner.py` ported as-is from sports-modeling. Scaffolding from the prior milestone is in place.

## Active Items
- Repo at `/Users/schnapp/code/schnapp-bet`. PYTHONPATH for workflows is `/Users/schnapp/code/schnapp-bet`.
- 17 plugins declared in `.claude/settings.json`; bootstrap runs on SessionStart.
- `docs/HEALTH.md` is gitignored — regenerate locally via `/skill regenerate-health` when needed.
- Bootstrap-vs-migrations: hybrid per ADR-20260517-1.
- Three Python files ported pass `ast.parse`: `shared/db.py` (126), `shared/integrity.py` (1175), `services/flask/runner.py` (189).

## Next Up (continuing code port)
- Port `etl/odds_etl.py` — first ETL touch; verifies `.claude/rules/etl.md` FanDuel-only rule fires on real code.
- Port `etl/nba_etl.py` and the NBA loaders (`etl/nba_live.py`, `etl/lineup_poll.py`). Big files; consider splitting per-script ports across sessions.
- Port `grading/grade_props.py` (very large file, ~140 KB in sports-modeling). Plan a per-concern split before porting.
- Split `CRITICAL_FIELDS` / `RELATIONAL_CHECKS` in `shared/integrity.py` into per-sport modules during the NBA pipeline port.
- Scaffold `web/` (`package.json`, `next.config.mjs`, `tailwind.config.ts`, `app/layout.tsx`, `lib/db.ts`, `middleware.ts`) before any per-route code.
- Workflows port alongside the code they trigger; `.claude/rules/workflows.md` is already in place.

## Recommendation for next session
Start a fresh Claude Code session before tackling `etl/odds_etl.py` (~2,000 lines) and the NBA pipeline. The remaining ports are large and benefit from a clean context. Read MEMORY.md and LEARNED.md to pick up here.

## Blockers
None.
