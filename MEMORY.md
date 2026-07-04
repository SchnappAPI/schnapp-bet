# MEMORY.md

## Current Focus

**MLB research dashboard — plan + Phase 1 shipped (2026-07-04, web session, branch `claude/video-recreation-feasibility-gkym1f`, PR #9).** Owner wants the Power BI `mlbSavantV3` batter dashboard recreated in-app. Plan at `docs/features/mlb-research-dashboard.md` (5 phases; xBA = `hit_probability` proxy for v1; pre-compute at player-game grain, date-slice in SQL). Phase 1 done in `etl/mlb_play_by_play.py`: new `mlb.player_game_statcast` (per batter-game Statcast aggregates, raw sums + averages, `runs` via deduped `batting_stats` join — its `batter_game_id` embeds team_id so a (game, player) can have 2 rows), per-hand quality splits on `player_trend_stats` (xbh/avg_ev/hard_hit_pct/avg_xba/babip, both compute paths in lockstep), quality-of-contact on `career_batter_vs_pitcher`, plus a pre-existing-bug fix (BvP aggregates now exclude `_NON_PA_EVENTS` noise that inflated AB and diluted AVG/OBP/SLG/OPS). Backfill verified green on mac-runner (run 28707813346): 6,166 games, 192,468 BvP pairs, 122,415 trend rows. Two dispatch failures en route (SQL optimizer 8624 → stage at-bats in #gsc_ab temp table; PK fan-out → dedupe box join); pipeline-failure Issue #10 closed. **Pending on the Mac:** `/skill regenerate-bootstrap-sql` (live DB has the new schema) and a Savant spot-check of a few batters' aggregates. Phases 2–5 (research API → HeatCell UI + `/mlb/research` page → patterns/projection markets → optional Savant Parquet loader) are follow-up PRs. Note: `etl/mlb_play_by_play.py` got a wholesale ruff-format from the `ruff-lint.sh` PostToolUse hook — `style:` commit 18ad306 is mechanical.

**Deploy-swap incident (same session, fixed).** deploy-web's success path swaps /Users/schnapp/code/schnapp-bet for a fresh clone and deletes the old dir — the push-triggered deploy from the live-scores commit destroyed in-flight uncommitted review fixes mid-session (re-applied as e26da4e) and silently dropped the fresh clone's core.hooksPath (auto-push dead until re-set; now restored). Deploy workflow now guards the swap: aborts on dirty tree or unpushed commits (7dcff6a). Full writeup LEARNED.md 2026-07-04. Session rule: verify every push landed (`git rev-parse HEAD origin/main`) — the hook is not trustworthy after any deploy.

**MLB live scores + same-night finals (2026-07-04 early AM, same session as the 500 fix).** Owner asked for finals same night and live in-game data. Shipped NBA-parity overlay architecture: `web/lib/mlbLive.ts` (statsapi schedule+linescore, 1.5s cap, enrich-only — DB owns the list) wired into `mlb-games`, `mlb/game/[gamePk]` (now returns `{game, live}`), `games/today`, and `mlb-linescore` (live innings until nightly pbp). Clients repoll 30s while unfinished games on screen; status classification consolidated into `web/app/mlb/gameStatus.ts` (fixed 'Scheduled' rendering as live). ETL: `mlb_lineup_poll.py` gained `update_game_scores()` (targeted UPDATE, winner flags only on finals, never downgrades F) + game-day convention (now-6h) + cron window extended to 05:30 UTC — workflow renamed "MLB Game Day Poll". Verified: dispatched poller flipped all 13 of 7/3's stale games to F with correct scores; 7/4 slate loaded early via manual mlb-etl dispatch; live-label path first exercises with tonight's games (~17:20 UTC) — check a live game renders "Top/Bot Nth" + scores on /mlb. Not built (deliberate): live per-player boxscore during games (Box Score tab stays DB/nightly until pbp lands).

**MLB game-page 500 fix (2026-07-04 early AM, Mac session).** User-reported "Error: HTTP 500" on /mlb/game/824659 traced to missing indexes: `mlb.play_by_play` (1.84M rows), `mlb.batting_stats`, and `mlb.pitching_stats` had no `game_pk` index, so every game-scoped web query full-scanned; warm cache ~0.5s, but cold cache after the 02:12 Mac reboot blew the 15s mssql request timeout (ETIMEOUT in `web-prod.err.log`) and the linescore route 500'd. Fixed three ways in lockstep: indexes created on the live container, `DDL_CREATE_PBP_INDEXES` + `DDL_CREATE_BOXSCORE_INDEXES` added to `ensure_table()` in `etl/mlb_play_by_play.py`, and `database/mlb/bootstrap.sql` regenerated (also picked up `mlb.daily_lineups`, which the snapshot predated). Side find fixed for good: the bootstrap generator lived only at `/tmp/gen_ddl.py` and the reboot wiped it — reconstructed, verified byte-identical output, and checked in at `database/_shared/gen_ddl.py` (skill updated). Non-issue also diagnosed: at 3-4 AM CT yesterday's finals still show "Scheduled" and today's slate is absent — that's the designed nightly `mlb-etl` cadence (09:00 UTC), not a failure.

**MLB section expansion (2026-07-04, web session, branch `claude/mlb-section-enhancements-oqeesr`).** Built the pregame MLB experience end-to-end. ETL: `mlb_etl.py` now writes probable pitcher IDs for scheduled games (schedule `hydrate=probablePitcher`) and ends every run with `update_pitcher_hands` — a set-based self-heal of `mlb.games.*_pitcher_hand` from `mlb.players.pitch_hand` that repairs the box-score MERGE clobber and backfills all historical finals on first run (this alone activates the player-page vs-L/R filter and the grading platoon factor, no grading code change). New intraday poller `etl/mlb_lineup_poll.py` + `mlb-lineups.yml` (every 30 min, 15:00–02:30 UTC) captures confirmed lineups into new `mlb.daily_lineups` (CRITICAL_FIELDS-covered; facts only — projected lineups are derived at read time, ADR-20260704-1). Web: game page gained a Lineups tab (default pregame) with confirmed/projected lineups, L5/L10/L20 × vs-SP-hand windowed averages as pure client slices of one `/api/mlb/game/[gamePk]/lineups` payload; player page gained a Statcast exit-velocity view (`/api/mlb/player/[playerId]/atbats`, summary tiles matching ETL hard-hit/barrel definitions via new `statcastFormat.ts`), a vs-Upcoming-SP filter chip, and a career-BvP strip vs the upcoming probable (log route now returns `upcoming` + `bvp`); game cards show pitcher handedness. `web/mlb/README.md` truthed-out (was describing the retired 6-tab page). **Post-merge verification checklist (needs the Mac):** dispatch mlb-etl and confirm hands backfilled; dispatch mlb-lineups mid-afternoon and confirm 9 rows/team; curl the three new/changed endpoints; browser-check Lineups tab + Statcast view; confirm next mlb-grading run has non-null `opp_pitcher_hand`.

**Revamp pass (2026-07-03, web session, PR #3).** Truth audit traced every output to its roots: the Odds API key is DEACTIVATED (owner must restore it in 1Password — everything props-related is blocked on that); `mlb-pbp-etl` was never scheduled and its incremental trend path had two latent bugs (both fixed, nightly 09:30, catch-up backfill dispatched); NBA grading was re-grading a June slate daily (now skips stale slates); `nfl-etl` failed weekly on a season-flip bug (fixed, green). Shipped: pipeline-truth policy (ADR-20260703-1 — fatal auth errors, in-season zero-work = error, heartbeats everywhere, deduped failure Issues), MLB markets 4→16 (`mlb-v1.1`), `batter_context`+`batter_projections` (ADR-0004 complete), `/mlb/grades` page, NFL foundation (ADR-20260703-2 — mappings, integrity, `/nfl` page; grading contracted for September), MLB/NFL integrity coverage via a `shared.db.upsert` catalog hook, docs truth-out (ROADMAP rewritten post-cutover, stale STATUS lines fixed).

**Earlier the same day (quick-wins pass).** Full-repo audit + quick-win fixes on branch `claude/schnapp-bet-improvements-fr3bky`: deleted shipped one-shot workflows and dead migration scripts, added `concurrency:` groups to all recurring workflows, stopped 39 API routes leaking raw DB errors (new `web/lib/apiError.ts`), deleted dead `GameTabs.tsx`, fixed `rotate-op-token.sh` to also update `~/.zshenv`, and fixed doc drift (integrity-module path, ADR router, CHANGELOG pointers). Prioritized backlog — CI/testing foundation, `get_engine`/`safe_*` consolidation, NFL integrity gap, grading-v2 Phases 8–9 decision, ops hardening — lives in `docs/reviews/2026-07-03-repo-improvement-review.md`. The two secrets flagged in `grading-v2/memory.md` (ANTHROPIC_API_KEY, CLAUDE_CODE_OAUTH_TOKEN) were rotated — owner confirmed 2026-07-03; the stale flags there are marked RESOLVED.

**Cutover complete (2026-05-18).** Full code port plus first-run integration done. End-to-end smoke verified by running `nba-etl.yml` on the new mac-runner-1: 1Password load-secrets-action resolved, Python ETL connected to SQL Server via the Webshare proxy, 30 teams + 1320 schedule rows + 1306 games + 160 usage-stat rows upserted. Two HTTP 503s on `boxscoreadvancedv3` were transient stats.nba.com noise handled by the runner's retry logic.

Live agents on Schnapps-MBP (post-cutover):

- `bet.schnapp.flask` — Flask runner on port 5000, started via `services/launchd/op-wrap.sh`.
- `bet.schnapp.web-prod` — Next.js prod on port 3001, served from `web/.next/`, started via op-wrap.
- `actions.runner.SchnappAPI-schnapp-bet.mac-runner-1` — self-hosted GH Actions runner.

Post-cutover housekeeping (2026-05-18 afternoon) is also done:

- Retired `bet.schnapp.web` dev agent + plist. Dev mode is now interactive-only (`npm run dev`).
- Deleted `.pre-1password` and `.pre-phase4.bak` plist backups (no more plaintext secrets on disk except `~/.zshrc`).
- Renamed every in-repo `sports-modeling` reference that pointed at the DB or repo. The live SQL Server database was already named `schnapp-bet` (rename happened during the Azure→Mac migration months ago); no ALTER DATABASE was needed.
- Dropped the `sports-modeling-azure-20260427` backup DB. BACPAC files at `/Users/schnapp/azure-sql-backups/` retained per the new invariant in `.claude/rules/database.md`.
- Fixed three `web/app/api/refresh-*.ts` routes that hardcoded `sports-modeling` as the GitHub repo.
- Deleted `infrastructure/README.md` (its content fully duplicated `docs/CONNECTIONS.md` + the runbooks). BACPAC invariant moved to `.claude/rules/database.md`.
- Pruned stale dev-agent references from `docs/runbooks/deploy-web.md`, `docs/runbooks/tunnels-and-dns.md`, and `docs/CONNECTIONS.md`.

Rotation complete: `OP_SERVICE_ACCOUNT_TOKEN` (regenerated in 1Password, propagated to `~/.zshrc` + GitHub repo secret + both launchd agents) and `ADMIN_PASSCODE` (new value in vault, picked up via `op run` on web-prod restart). End-to-end smoke verified via `daily-health-report.yml` workflow — the `Load secrets from 1Password` step succeeded with the new token. The workflow's final "commit HEALTH.md" step failed because `docs/HEALTH.md` is gitignored per ADR-20260517-2 D5 and the workflow's logic was carried over from sports-modeling where it wasn't; deleted the workflow since `/skill regenerate-health` is the replacement.

**No outstanding cutover work.** Platform is fully ported, wired through 1Password end-to-end, with no plaintext secrets on disk beyond `OP_SERVICE_ACCOUNT_TOKEN` in `~/.zshrc`.

## Active Conventions (current state — read before committing)

- **Commit subject format is mandatory and enforced** (ADR-20260517-4):
  ```
  <type>: [scope1][scope2] short description — ADR-YYYYMMDD-N (optional)
  ```
  `.githooks/commit-msg` rejects malformed subjects before the commit lands. Types: `feat | fix | refactor | docs | chore | perf | test | style | revert`. Tags: `[nba] [mlb] [nfl] [shared] [etl] [grading] [web] [database] [odds] [services] [infra] [docs] [meta] [all]`.
- **One logical change per commit**, not one file (ADR-20260517-3). The commit subject IS the changelog entry.
- **Auto-push is active.** Every successful commit pushes to `origin/main` via `.githooks/post-commit`.
- **No CHANGELOG file.** `git log` is the changelog. Filter with `git log --grep='\[scope\]'`.
- **No per-directory CLAUDE.md pointers.** Path-scoped rules under `.claude/rules/` auto-load.
- **Session lifecycle scales by task size** (ADR-20260517-3): Trivial → commit only. Routine → commit + MEMORY.md. Milestone → commit + MEMORY.md + ADR. Mid-session correction → LEARNED.md immediately.
- **1Password is the secrets source** (ADR-20260517-5). Vault `web-variables`. Mapping at `.env.template`. Local: `op run --env-file=.env.template -- <cmd>`. Workflows: `1password/load-secrets-action@v2`. Bootstrap token: `OP_SERVICE_ACCOUNT_TOKEN` in `~/.zshrc` (local), only repo-level GH secret in CI. launchd: invoke via `services/launchd/op-wrap.sh`.
- **Fail closed on missing security secrets in production** (ADR-20260617-1). `web/lib/secrets.ts` `requireSecret(name, devDefault)` throws in prod, returns the dev default otherwise; call it lazily (never at module scope, or `next build` breaks). Auth routes + middleware reject with 500 when `AUTH_TOKEN_SECRET` is unset in prod; runner-proxy routes never send the default `X-Runner-Key`. `services/flask/runner.py` raises at startup if `RUNNER_API_KEY` is unset (removed the `runner-Lake4971` default, fulfilling ADR-20260517-5 D6). No published-default fallbacks remain.

## Code state

All ported as-is from sports-modeling (`/Users/schnapp/sports-modeling/`). Python files pass `ast.parse`.

**ETL** (`etl/`):

- `odds_etl.py` (2009 lines) — FanDuel-only invariant at `BOOKMAKERS = "fanduel"`.
- `nba_etl.py` (1357), `nba_live.py` (201), `lineup_poll.py` (384) — NBA pipeline.
- `mlb_etl.py` (776), `mlb_play_by_play.py` (1817) — MLB pipeline (statsapi.mlb.com).
- `nfl_etl.py` (388) — NFL pipeline (nflreadpy).
- `cleanup_stale_odds_and_grades.py`, `compute_patterns.py`, `game_day_gate.py`, `gate_check.py`, `migrate_common_teams.py`, `nba_clear.py`, `seed_user_codes.py`, `requirements.txt`.
- `backfill/` — 7 historical loaders + 2 storage helpers.

**Grading** (`grading/`):

- `grade_props.py` (3112), `mlb_grade_props.py` (1055), `weekly_calibration.py` (857), `generate_supplemental.py` (552), plus calibration/migration/backfill/verify utilities. `requirements.txt`.
- Per-concern split DEFERRED — port-as-is. (Per "simple over complex" directive.)

**Shared** (`shared/`):

- `db.py` (126) — engine, retry, upsert.
- `integrity.py` (1175+) — three-layer integrity framework (ADR-20260424-2). Per-sport split deferred until 2nd sport's contracts show up.

**Web** (`web/`):

- Full Next.js 15 tree from sports-modeling. 130 files. `package.json` renamed to `schnapp-bet-web`. Top-level `package.json` workspace renamed to `schnapp-bet`.

**Workflows** (`.github/workflows/`):

- All 27 workflows ported. `secrets.SQL_*`, `secrets.NBA_PROXY_URL`, `secrets.ODDS_API_KEY`, `secrets.ANTHROPIC_API_KEY`, `secrets.CLAUDE_CODE_OAUTH_TOKEN` replaced with `1password/load-secrets-action@v2` steps using `op://web-variables/...` URIs.
- `OP_SERVICE_ACCOUNT_TOKEN` is the only repo-level GitHub secret each workflow expects.
- `PYTHONPATH` updated to `/Users/schnapp/code/schnapp-bet`.
- `deploy-web.yml`: clone URL → `SchnappAPI/schnapp-bet.git`; live-dir swap target → `$BASE/schnapp-bet`.

**Services** (`services/`):

- `flask/runner.py` (189) — NBA CDN proxy on port 5000.
- `launchd/op-wrap.sh` — sources `OP_SERVICE_ACCOUNT_TOKEN` from `~/.zshrc`, exec's `op run --env-file=.env.template -- "$@"`. Smoke-tested.
- `launchd/bet.schnapp.flask.plist`, `launchd/bet.schnapp.web-prod.plist` — plists with no embedded secrets.

**Database** (`database/`):

- `_shared/bootstrap.sql` (566 lines), `nba/bootstrap.sql` (161), `mlb/bootstrap.sql` (412), `nfl/bootstrap.sql` (833). Sport schemas regenerate-on-empty per ADR-20260517-1.

**Docs and policy**:

- 5 ADRs for today: ADR-20260517-1 through -5.
- `.env.template` (root) — canonical env-var → `op://` URI mapping. ~20 vars.
- `.githooks/post-commit` (auto-push), `.githooks/commit-msg` (subject format enforcement).
- `.claude/hooks/protect-files.sh` — substring-blocks `.env`, `.plist`, `package-lock.json`, `sql-server.env`, `.git/`. Allowlist: `.env.template`, `services/launchd/`.

## Manual actions (completed 2026-05-18 — see `docs/cutover.md` for the scripts)

Steps 1–4 are DONE. Steps 5–6 are optional and outstanding.

1. **Set the GitHub repo secret.** Workflows will fail until this is set:

   ```bash
   gh secret set OP_SERVICE_ACCOUNT_TOKEN --repo SchnappAPI/schnapp-bet
   # Paste the same value that's in ~/.zshrc:10 when prompted.
   ```

2. **Re-register the self-hosted mac-runner.** It currently points to `SchnappAPI/sports-modeling`. Two options:
   - Add a runner under `SchnappAPI/schnapp-bet` repo settings, install a new agent on Schnapps-MBP. (Easier to keep two repos running in parallel.)
   - Or unregister from sports-modeling, re-register against schnapp-bet, replace the launchd plist (`actions.runner.SchnappAPI-sports-modeling.mac-runner-1.plist`).

3. **Install the new launchd plists** (replaces the old `~/Library/LaunchAgents/bet.schnapp.flask.plist` and `bet.schnapp.web-prod.plist` that point at `/Users/schnapp/sports-modeling/` and carry plaintext secrets):

   ```bash
   launchctl unload ~/Library/LaunchAgents/bet.schnapp.flask.plist
   launchctl unload ~/Library/LaunchAgents/bet.schnapp.web-prod.plist
   cp services/launchd/bet.schnapp.flask.plist     ~/Library/LaunchAgents/
   cp services/launchd/bet.schnapp.web-prod.plist  ~/Library/LaunchAgents/
   launchctl load   ~/Library/LaunchAgents/bet.schnapp.flask.plist
   launchctl load   ~/Library/LaunchAgents/bet.schnapp.web-prod.plist
   ```

4. **Build web for prod** (the live dir `/Users/schnapp/schnapp-bet/` referenced by `bet.schnapp.web-prod.plist` doesn't exist yet):

   ```bash
   cd web && op run --env-file=../.env.template -- npm ci && op run --env-file=../.env.template -- npm run build
   # Then create or symlink /Users/schnapp/schnapp-bet/ to point at this repo's web/ dir.
   ```

5. **SQL Server container / database name.** 1Password's `Database/database` field still says `sports-modeling`. Either:
   - Rename the database in the live SQL Server container to `schnapp-bet` and update the vault field. (Requires a brief downtime.)
   - Or leave the database name as `sports-modeling` indefinitely (the name is internal — only 1Password and connection strings reference it).
   - Same decision applies to `SQL_CONNECTION_STRING` in 1Password — its `Database=sports-modeling;` substring.

6. **(Optional) Rotate `OP_SERVICE_ACCOUNT_TOKEN`** if you suspect it's leaked. Today's events: it appeared in this session's transcript (when grepping `~/.zshrc`). If shoulder-surfing or transcript exfiltration is a real concern, rotate the service account.

## Decision chain (this & prior sessions)

`docs/decisions/ADR-20260517-1` → `-2` → `-3` → `-4` → `-5` → `ADR-20260524-1`. Read in order for the full reasoning behind the meta layer:

1. **ADR-20260517-1** — Hybrid bootstrap strategy: regenerate sport schemas, migrate `common.*`.
2. **ADR-20260517-2** — Scaffolding milestone disposition.
3. **ADR-20260517-3** — Atomic logical commits, drop per-directory CLAUDE.md pointers, scale session ceremony.
4. **ADR-20260517-4** — `git log` is the changelog; drop `docs/changelog/`.
5. **ADR-20260517-5** — 1Password vault `web-variables` is the single source of truth for runtime secrets.
6. **ADR-20260524-1** — Mechanize destructive-command non-negotiable as PreToolUse Bash hook with single-use bypass file. Companion automations: ruff PostToolUse hook, adr-writer skill, etl-integrity-reviewer subagent.

## Decisions resolved this session

- **Port everything as-is.** Grading split deferred. Per-sport `CRITICAL_FIELDS` split deferred. `web/`, `grading/`, `workflows/`, `services/`, `database/` all carried verbatim (or with mechanical 1Password adaptation). Simpler now; refactor when there's a concrete reason.
- **launchd plists never carry secrets.** `services/launchd/op-wrap.sh` reads `OP_SERVICE_ACCOUNT_TOKEN` from `~/.zshrc` at process start and `exec`s `op run --env-file=.env.template -- "$@"`. Plists hold zero secret values.
- **Per-sport integrity split STILL DEFERRED.** Comment at `shared/integrity.py:90-93` records the rationale. Re-decide when MLB and NFL ETLs actually run.

## Next Up (2026-05-24)

App-simplification redesign (spec: `docs/superpowers/specs/2026-05-24-app-simplification-design.md`) — Sessions 1–7 complete. **Session 8 = QA + polish + `/deploy`.**

What shipped in Sessions 1–7:

- NBA: HomeHub, Games tab date nav, Players tab + recent, /nba/game/[gameId], /nba/player/[playerId] (log + splits + filters + mobile sheet)
- MLB: API routes (game/player log/player splits) + full UI parity (/mlb tabs, /mlb/game/[gamePk], /mlb/player/[playerId])

Session 8 checklist (see `memory/project_session8_handoff.md` for details):

- Browser smoke all new MLB routes
- Verify schnapp_recent_mlb_players localStorage saves on player visit
- `/deploy`
