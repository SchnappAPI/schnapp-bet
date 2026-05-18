# MEMORY.md

## Current Focus

Code port underway. `shared/db.py`, `shared/integrity.py`, `services/flask/runner.py`, and `etl/odds_etl.py` ported as-is from sports-modeling. Scaffolding from the prior milestone is in place. Prior session's 32 staged entries committed one-per-file (56 commits total).

## Active Items

- Repo at `/Users/schnapp/code/schnapp-bet`. PYTHONPATH for workflows is `/Users/schnapp/code/schnapp-bet`.
- 17 plugins declared in `.claude/settings.json`; bootstrap runs on SessionStart.
- `docs/HEALTH.md` is gitignored — regenerate locally via `/skill regenerate-health` when needed.
- Bootstrap-vs-migrations: hybrid per ADR-20260517-1.
- Four Python files ported pass `ast.parse`: `shared/db.py` (126), `shared/integrity.py` (1175), `services/flask/runner.py` (189), `etl/odds_etl.py` (2009).
- FanDuel-only invariant verified in `etl/odds_etl.py`: `BOOKMAKERS = "fanduel"` at line 128, used by all 5 Odds API call sites.

## Next Up (continuing code port)

- Port `etl/nba_etl.py` next, then the NBA loaders (`etl/nba_live.py`, `etl/lineup_poll.py`). Big files; the NBA pipeline port is when the per-sport `CRITICAL_FIELDS` / `RELATIONAL_CHECKS` split decision should be made.
- Port `grading/grade_props.py` (very large file, ~140 KB in sports-modeling). Plan a per-concern split before porting.
- Split `CRITICAL_FIELDS` / `RELATIONAL_CHECKS` in `shared/integrity.py` into per-sport modules during the NBA pipeline port.
- Scaffold `web/` (`package.json`, `next.config.mjs`, `tailwind.config.ts`, `app/layout.tsx`, `lib/db.ts`, `middleware.ts`) before any per-route code.
- Workflows port alongside the code they trigger; `.claude/rules/workflows.md` is already in place.

## Recommendation for next session

Start a fresh Claude Code session before tackling the NBA pipeline (`etl/nba_etl.py`, `etl/nba_live.py`, `etl/lineup_poll.py`). The remaining ports are large and the `CRITICAL_FIELDS` per-sport split decision benefits from a clean context. Read MEMORY.md and LEARNED.md to pick up here.

## Blockers

None.
