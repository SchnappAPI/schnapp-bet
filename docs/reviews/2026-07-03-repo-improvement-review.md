# Repo Improvement Review — 2026-07-03

> **Addendum (same day, revamp pass):** a live truth audit (DB + workflow logs)
> and a follow-up revamp landed on the same branch. Root causes found and fixed:
> dead Odds API key silently skipped since 4/24 (now fatal, ADR-20260703-1);
> `mlb-pbp-etl` never scheduled + two latent trend-stats bugs (inverted ternary,
> missing `_merge_trend_stats`) froze pitch-level data 4/30 (fixed + nightly);
> NBA grading re-graded a stale June slate daily (now skips); `nfl_etl` season
> flip 404'd weekly since 6/2 (fixed, green). Shipped beyond the quick wins:
> MLB markets 4→16 (`mlb-v1.1`), `mlb.batter_context`/`batter_projections`
> (ADR-0004 complete), `/mlb/grades` surface, NFL foundation (mappings,
> integrity, `/nfl` page — ADR-20260703-2), universal workflow heartbeats +
> deduped failure Issues, MLB/NFL integrity coverage. The backlog sections
> below remain valid for what they still list (CI, consolidation, grading-v2
> Phases 8–9, ops hardening).

Full-repo analysis (Python ETL/grading, Next.js web, workflows/infra/docs) run 2026-07-03.
Verdict: architecture and secrets discipline are solid; the biggest structural gaps are
**zero test/CI gating**, **copy-paste drift across sports**, and **stale ops surface**
(broken workflows, doc drift). The "Fixed" section landed with this review; everything
under "Recommended next" is prioritized backlog.

## Fixed on this branch (2026-07-03)

- Deleted 5 shipped/broken one-shot workflows (`mlb-migrate` referenced a nonexistent
  SQL file and ran `apt-get` on the Mac runner; `nba-clear`, `grades-migrate`,
  `migrate-common-teams`, `backfill-relevance` had shipped) and 6 completed one-off
  scripts (`calibrate_grades.py`, `migrate_grades_v2.py`, `migrate_tier_lines_v3.py`,
  `backfill_relevance_only.py`, `verify_tier_rows.py`, `migrate_common_teams.py`).
- Added per-workflow `concurrency:` groups (queue, never cancel) to all 20 recurring/
  dispatchable workflows. Previously a slow `nba-game-day` run could overlap the next
  15-minute tick, and the UI refresh button could race scheduled ETL/grading.
- Stopped 39 API routes returning raw `err.message` (SQL driver/schema detail) to
  clients — new `web/lib/apiError.ts` logs server-side, returns generic bodies.
- Deleted dead `web/components/GameTabs.tsx` (531 lines, zero imports) and the
  `next.config.mjs` cache rule for the nonexistent `/api/grades/signals/today`.
- `rotate-op-token.sh` now updates `~/.zshenv` and the live launchd env, not just
  `~/.zshrc` — before this, a rotation left a stale token that broke service loads
  after the next reboot.
- Doc drift: `etl/integrity.py` → `shared/integrity.py` in database READMEs; eight
  READMEs pointed at the abolished `/docs/CHANGELOG.md`; decisions router was missing
  the five ADRs since 20260517-2; launchd runbook curled `/health` (Flask serves
  `/ping`); `retry-incomplete.yml` referenced the deleted `daily-health-report`.

## Security follow-ups (manual — cannot be done from a repo branch)

1. ~~Rotate two exposed secrets.~~ **RESOLVED 2026-07-03** — owner confirmed both
   were already rotated; the stale flags in `grading-v2/memory.md` and `MEMORY.md`
   are marked RESOLVED.
1b. **Restore the Odds API key.** Found in the same-day truth audit: the key is
   deactivated ("cancelation or failed payment"), which froze odds ingestion on
   2026-04-24 and silently killed MLB grading from 5/1. Pipelines now fail loudly
   while it is dead (ADR-20260703-1). New key → `op://web-variables/ODDS_API_KEY/credential`.
2. **Decide on open-API exposure.** Only `/api/search` is auth-gated
   (`web/middleware.ts`); every other data route (grades, players, games, tier-grid,
   all MLB) is deliberately public. That is a total-scrape exposure of the product's
   dataset. If deliberate, fine — but it deserves an ADR, and rate limiting at the
   Cloudflare tunnel would be cheap insurance.

## Recommended next (in priority order)

### 1. CI + testing foundation (highest leverage; currently zero)

- No tests exist anywhere: no `tests/`, no pytest/vitest, one `assert` in the entire
  Python codebase, and no workflow runs a test or blocking lint. The only automated
  check is `next build` inside `deploy-web.yml` — post-merge, not gating.
- The grading engine (3,112-line `grade_props.py`) has a history of exactly the bug
  class unit tests catch: tuple-arity regressions (see `.claude/rules/grading.md`
  "never revert to 5 or 6 elements"), the `opportunity_streak_epoch` typo, the
  IDENTITY-column bug.
- Start small: pytest over the pure functions (American-odds ↔ implied-probability
  math, `safe_*` coercion, `pav_isotonic`, EV computation), an ESLint config (none
  exists — `npm run lint` has never run), `tsc --noEmit` + `ruff` in one PR-triggered
  workflow on `ubuntu-latest` (no DB needed for these).

### 2. Consolidation (drifted copies are already lying)

- `get_engine` is redefined in 9 files despite `shared/db.py` and an explicit rule
  against it. Copies have drifted: different retry waits, and `grade_props.py:378` /
  `nba_etl.py:414` still say "Could not connect to **Azure SQL**" (decommissioned).
- `safe_int/safe_float/...` duplicated in `nba_etl.py`, `mlb_etl.py`,
  `mlb_play_by_play.py`; odds math duplicated in `grade_props.py`,
  `mlb_grade_props.py`, `weekly_calibration.py` — all pure functions, trivial to hoist
  into `shared/` (and the first pytest targets).
- **`nfl_etl.py` bypasses `shared.integrity` entirely** — the only sport writing
  without Layer 1/2/3 validation (ADR-20260424-2 gap).
- Every workflow copy-pastes the same ~20-line checkout + 1Password + venv preamble
  and hardcodes `PYTHONPATH=/Users/schnapp/code/schnapp-bet`; a reusable
  `workflow_call` (or composite action) would collapse the three sport ETLs and two
  grading workflows into parameterized calls.
- `grading/requirements.txt` lists only scipy + anthropic but the code imports pandas/
  sqlalchemy/pyodbc (installed implicitly via `etl/requirements.txt` into the shared
  venv); `anthropic>=0.28.0` is the only unpinned dep. One consolidated, fully pinned
  spec (or `pyproject.toml` with extras) fixes both.

### 3. Finish or shelve grading-v2

- Phases 1–7 (backend) shipped; Phases 8–9 (web reads `player_value_lines` +
  historical re-grade) never started. The web still renders the composite grade while
  the backend computes model_prob/EV. Vestiges: `tier_rows` permanently empty for NBA,
  KDE path kept only for MLB.
- Decide, then archive `grading-v2/` (a scratch plan/memory/handoffs directory from
  2026-05-05 that duplicates the MEMORY.md system and still references
  sports-modeling).

### 4. Structural debt (as touched)

- Split candidates: `grade_props.py` 3,112 lines / 50 functions / 0 classes;
  `odds_etl.py` 2,009; `mlb_play_by_play.py` 1,817; `PlayerPageInner.tsx` 2,269;
  `GradesPageInner.tsx` 1,182. Replace the positional 7-tuple `_common_grade_data`
  contract with a dataclass.
- Retire legacy `web/components/PropMatrix.tsx` (648 lines, no virtualization) — still
  imported by `PropsSection.tsx` and `GradesPageInner.tsx`; the tanstack-virtualized
  `components/nba/PropMatrix.tsx` is the current generation.
- Unify the MLB API surface: 9 flat `mlb-*` routes vs 3 nested `mlb/` routes (NBA is
  all-nested); 38 of 57 routes bypass `lib/queries.ts` with inline SQL.
- Perf leads: `mlb-player` route runs 8 sequential DB round-trips per request
  (parallelize/join); `mlb-ev` and `tier-grid` scan `mlb.player_at_bats` per poll —
  verify covering indexes; a game page holds 10+ independent SWR pollers (coordinate).
- Cache policy is split between `next.config.mjs` headers and per-route exports —
  pick one home.
- `web/nba|mlb|nfl|_shared/` are documentation-only directories that look like app
  code; consider `web/docs/<sport>/` or folding into `docs/`.

### 5. Ops hardening

- **No failure notification on any scheduled workflow.** A failed 09:00 ETL or 11:00
  grading run is silent until the UI looks stale. Add a shared `if: failure()` step
  (open/update a GitHub Issue) to the scheduled workflows.
- `retry-incomplete.yml`'s two retry handlers are dead code — they import
  `fetch_scoreboard_games`/`fetch_boxscore` which were never implemented ("Phase 7"),
  so rows only age into Issue escalation. Implement the fetchers or simplify the
  workflow to pure escalation.
- No `database/migrations/` mechanism exists despite `.claude/rules/database.md`
  mandating it for `common.*` — today there are three competing DDL sources
  (bootstrap snapshots, DDL-in-Python, ad-hoc scripts). Create the directory + a tiny
  idempotent runner workflow.
- No automated SQL Server backup is scheduled or verified from the repo (BACPACs at
  `/Users/schnapp/azure-sql-backups/` are pre-migration artifacts). Schedule a dump +
  restore-test; single-host fragility (runner, DB, web, Flask, tunnel all on
  Schnapps-MBP) makes backups the only recovery story.
- Cross-workflow serialization: this branch added per-workflow concurrency groups;
  `refresh-data`, `refresh-lines`, and `nba-game-day` all drive `odds_etl --mode
  upcoming` + grading and could still interleave with each other. If interleaving
  shows up in practice, put them in one shared group.
