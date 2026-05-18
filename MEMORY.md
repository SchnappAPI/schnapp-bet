# MEMORY.md

## Current Focus

schnapp-bet meta layer is locked. Policy and tooling work shipped today: auto-push enforcement, commit-msg format hook, deletion of the CHANGELOG file (`git log` is now the changelog), 1Password vault `web-variables` as single secrets source. ADR chain so far: ADR-20260517-1 through -5. NBA pipeline ported as-is from sports-modeling: `nba_etl.py`, `nba_live.py`, `lineup_poll.py`. Remaining sport pipelines (MLB, NFL), workflows, and the grading engine port are next — all will consume secrets through `op run` / `1password/load-secrets-action`.

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
- **1Password is the secrets source** (ADR-20260517-5). Vault `web-variables` holds every runtime secret. The mapping of env-var → `op://` URI is `.env.template` at repo root. Local: `op run --env-file=.env.template -- <cmd>`. Workflows: `1password/load-secrets-action@v2`. Bootstrap token: `OP_SERVICE_ACCOUNT_TOKEN` (in `~/.zshrc` locally; only repo-level GH secret in CI).

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
- `etl/nba_etl.py` (1357 lines) — `stats.nba.com` endpoints, Webshare proxy via `NBA_PROXY_URL`.
- `etl/nba_live.py` (201 lines) — `cdn.nba.com/static/json/liveData/` scoreboard + boxscore.
- `etl/lineup_poll.py` (384 lines) — `stats.nba.com/js/data/leaders/00_daily_lineups_*` + boxscorepreviewv3.

Not yet ported:

- `etl/mlb_*.py` — MLB pipeline (`mlb_etl.py` 33758 B, `mlb_play_by_play.py` 84930 B).
- `etl/nfl_*.py` — NFL pipeline (`nfl_etl.py` 13910 B).
- `grading/grade_props.py` (~140 KB), `grading/mlb_grade_props.py` — grading engine.
- `web/` — Next.js app, not yet scaffolded.

## Decision chain (today)

`docs/decisions/ADR-20260517-1` → `-2` → `-3` → `-4` → `-5`. Read in order for the full reasoning behind the meta layer:

1. **ADR-20260517-1** — Hybrid bootstrap strategy: regenerate sport schemas, migrate `common.*`.
2. **ADR-20260517-2** — Scaffolding milestone disposition.
3. **ADR-20260517-3** — Atomic logical commits, drop per-directory CLAUDE.md pointers, scale session ceremony.
4. **ADR-20260517-4** — `git log` is the changelog; drop `docs/changelog/`.
5. **ADR-20260517-5** — 1Password vault `web-variables` is the single source of truth for runtime secrets.

## Next Up

In priority order:

1. **MLB pipeline port** — `etl/mlb_etl.py` (33.7 KB) + `etl/mlb_play_by_play.py` (84.9 KB) from sports-modeling. Same port-as-is pattern. When this lands, the integrity split decision gets forced (see "Decisions resolved" below).
2. **NFL pipeline port** — `etl/nfl_etl.py` (13.9 KB) from sports-modeling. Smaller; can pair with MLB or stand alone.
3. **Web scaffold** — `package.json`, `next.config.mjs`, `tailwind.config.ts`, `app/layout.tsx`, `lib/db.ts`, `middleware.ts`. Independent of sport pipelines; can be a parallel session.
4. **Grading engine port** — `grading/grade_props.py` (~140 KB in sports-modeling). Plan a per-concern split before porting; do not port as a single file.
5. **Workflows port** — alongside the code they trigger. `.claude/rules/workflows.md` is in place. Don't forget the inline `core.hooksPath` setup line _and_ the `1password/load-secrets-action@v2` block with `op://` URIs (per ADR-20260517-5). Add `OP_SERVICE_ACCOUNT_TOKEN` as the only repo-level GitHub secret before running the first workflow.

## Decisions resolved this session

- **1Password is the secrets source** (ADR-20260517-5). Vault `web-variables` is populated with every secret schnapp-bet needs. Mapping committed at `.env.template`. CLAUDE.md, `.claude/rules/shared.md`, `.claude/rules/workflows.md` all updated. `op run` verified locally — all 9 env vars resolve. **Wiring not yet implemented**: workflows still don't exist, services aren't yet started via `op run`. The ADR is the contract; consumers land later.
- **Per-sport `CRITICAL_FIELDS` / `RELATIONAL_CHECKS` split: deferred** until a 2nd sport ports. Designing the partition before MLB/NFL contracts are known is speculative. Rationale recorded inline at `shared/integrity.py:90-93`. When MLB lands, decide the split shape based on what mlb tables actually need.
- **Pointer-file sweep finished.** `etl/CLAUDE.md`, `grading/CLAUDE.md`, `web/CLAUDE.md`, `shared/CLAUDE.md` all removed. Only the root `CLAUDE.md` remains. ADR-20260517-3 cleanup is now complete.

## How to continue (next session)

1. Read MEMORY.md (this file), then LEARNED.md. If the repo contradicts memory, the repo wins.
2. The commit-msg hook will reject malformed subjects on the first commit — SessionStart bootstrap activates `core.hooksPath` automatically, no manual setup needed.
3. Start the MLB pipeline port. Files live in `/Users/schnapp/sports-modeling/etl/`:
   ```
   wc -l /Users/schnapp/sports-modeling/etl/mlb_etl.py /Users/schnapp/sports-modeling/etl/mlb_play_by_play.py
   ```
4. Follow the established port-as-is pattern (used for `odds_etl.py` and the 3 NBA files):
   - `cp` from sports-modeling.
   - `python3 -c "import ast; ast.parse(open('etl/mlb_etl.py').read())"` to verify.
   - `diff -q` + `md5` to confirm byte-identical copy.
   - Spot-check sport-specific invariants (MLB stats API endpoints, stat columns).
   - Commit subject: `feat: [etl][mlb] port mlb_etl.py from sports-modeling as-is`.
5. When MLB lands, **decide the integrity split shape** — by that point you'll see what `mlb.*` tables need vs. what `nba.*` tables share.
6. Update MEMORY.md "Code state" section once at end of batch (Routine ceremony), not per file.

## Blockers

None.

## Recommendation

Start fresh. NBA pipeline files are large and the per-sport `CRITICAL_FIELDS` split decision benefits from clean context.
