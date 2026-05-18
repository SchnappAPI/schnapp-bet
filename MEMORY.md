# MEMORY.md

## Current Focus

schnapp-bet meta layer is locked. Policy and tooling work shipped today: auto-push enforcement, commit-msg format hook, deletion of the CHANGELOG file (`git log` is now the changelog), and a 2-ADR chain establishing the new conventions (ADR-20260517-3 and ADR-20260517-4). The next major chunk is the NBA pipeline port from sports-modeling — start that with a fresh session.

## Active Conventions (new this session — read before committing)

- **Commit subject format is mandatory and enforced** (ADR-20260517-4):
  ```
  <type>: [scope1][scope2] short description — ADR-YYYYMMDD-N (optional)
  ```
  `.githooks/commit-msg` rejects malformed subjects before the commit lands. Types: `feat | fix | refactor | docs | chore | perf | test | style | revert`. Tags: `[nba] [mlb] [nfl] [shared] [etl] [grading] [web] [database] [odds] [services] [infra] [docs] [meta] [all]`.
- **One logical change per commit**, not one file (ADR-20260517-3). The commit subject IS the changelog entry.
- **Auto-push is active.** Every successful commit pushes to `origin/main` via `.githooks/post-commit`. Stop hook is a safety net for missed pushes.
- **No CHANGELOG file.** `git log` is the changelog. Filter with `git log --grep='\[scope\]'`. Pre-policy commits used `type(scope):` style — cover both with `git log --grep='\[meta\]\|(meta)'`.
- **No per-directory CLAUDE.md pointers.** Path-scoped rules under `.claude/rules/` auto-load when editing matching paths.
- **Session lifecycle scales by task size** (ADR-20260517-3):
  - Trivial → commit only.
  - Routine → commit + MEMORY.md.
  - Milestone → commit + MEMORY.md + ADR.
  - Mid-session correction → LEARNED.md immediately.
- **Per-clone setup**: `git config --local core.hooksPath .githooks` activates both hooks. SessionStart bootstrap (`.claude/bootstrap-plugins.sh`) sets this automatically in Claude Code. mac-runner workflows must set it inline before any git operation (`.claude/rules/workflows.md`).

## Active Items

- Repo at `/Users/schnapp/code/schnapp-bet`. PYTHONPATH for workflows is `/Users/schnapp/code/schnapp-bet`.
- 17 plugins declared in `.claude/settings.json`; bootstrap runs on SessionStart, installs missing plugins, and activates `core.hooksPath`.
- `.githooks/` contains: `post-commit` (auto-push), `commit-msg` (subject format enforcement).
- `docs/HEALTH.md` is gitignored — regenerate locally via `/skill regenerate-health` when needed.
- Bootstrap-vs-migrations: hybrid per ADR-20260517-1.
- All work pushed to `origin/main` — zero unpushed commits at session end.

## Code state

Ported as-is from sports-modeling, all passing `python3 -c "import ast; ast.parse(...)"`:

- `shared/db.py` (126 lines) — engine, retry, upsert helpers.
- `shared/integrity.py` (1175 lines) — three-layer integrity framework (ADR-20260424-2).
- `services/flask/runner.py` (189 lines) — NBA CDN proxy on port 5000.
- `etl/odds_etl.py` (2009 lines) — FanDuel-only invariant preserved at `BOOKMAKERS = "fanduel"`.

Not yet ported:

- `etl/nba_etl.py`, `etl/nba_live.py`, `etl/lineup_poll.py` — NBA pipeline.
- `etl/mlb_*.py` — MLB pipeline.
- `etl/nfl_*.py` — NFL pipeline.
- `grading/grade_props.py` (~140 KB), `grading/mlb_grade_props.py` — grading engine.
- `web/` — Next.js app, not yet scaffolded.

## Decision chain (today)

`docs/decisions/ADR-20260517-1` → `-2` → `-3` → `-4`. Read in order for the full reasoning behind the meta layer:

1. **ADR-20260517-1** — Hybrid bootstrap strategy: regenerate sport schemas, migrate `common.*`.
2. **ADR-20260517-2** — Scaffolding milestone disposition.
3. **ADR-20260517-3** — Atomic logical commits, drop per-directory CLAUDE.md pointers, scale session ceremony.
4. **ADR-20260517-4** — `git log` is the changelog; drop `docs/changelog/`.

## Next Up

In priority order:

1. **NBA pipeline port** — `etl/nba_etl.py` first, then `etl/nba_live.py`, then `etl/lineup_poll.py`. Big files. **Open question**: defer the per-sport `CRITICAL_FIELDS` / `RELATIONAL_CHECKS` split in `shared/integrity.py` until 2 sports are ported, or do it during the NBA port? Decide with fresh context.
2. **Web scaffold** — `package.json`, `next.config.mjs`, `tailwind.config.ts`, `app/layout.tsx`, `lib/db.ts`, `middleware.ts`. Independent of NBA pipeline; can be a parallel session.
3. **Grading engine port** — `grading/grade_props.py` (~140 KB in sports-modeling). Plan a per-concern split before porting; do not port as a single file.
4. **Workflows port** — alongside the code they trigger. `.claude/rules/workflows.md` is in place. Don't forget the inline `core.hooksPath` setup line.

## How to continue (next session)

1. Read MEMORY.md (this file), then LEARNED.md. If the repo contradicts memory, the repo wins.
2. The commit-msg hook will reject malformed subjects on the first commit — SessionStart bootstrap activates `core.hooksPath` automatically, no manual setup needed.
3. Start the NBA pipeline port:
   ```
   wc -l /Users/schnapp/sports-modeling/etl/nba_etl.py   # gauge size before reading
   ```
4. If the file is large (>2000 lines), skim imports, top-level constants, and the run-mode dispatcher first before reading implementation chunks.
5. Follow the established port-as-is pattern from `etl/odds_etl.py`:
   - `cp` from sports-modeling if no rewrites are needed.
   - Verify with `python3 -c "import ast; ast.parse(open('etl/nba_etl.py').read())"`.
   - Confirm sport-specific invariants survive (live-data API contracts, stat columns, etc.).
   - Commit with subject like `feat: [etl][nba] port nba_etl.py from sports-modeling as-is`.
6. Update MEMORY.md "Code state" section after each port lands.

## Blockers

None.

## Recommendation

Start fresh. NBA pipeline files are large and the per-sport `CRITICAL_FIELDS` split decision benefits from clean context.
