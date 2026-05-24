# MEMORY.md

## Current Focus

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

## Next Up

In priority order:

1. **Execute the manual actions above** — until GitHub secret is set + runner is re-registered + launchd plists are installed, nothing actually runs.
2. **End-to-end smoke**: trigger `nba-etl.yml` via `gh workflow run nba-etl.yml`. Watch the run. The "Load secrets from 1Password" step should succeed; the Python ETL should reach SQL Server.
3. **Web prod smoke**: load `http://127.0.0.1:3001` after the launchd plists are installed. Confirm SQL connection works (a `/api/games/today` response is a quick check).
4. **Cosmetic cleanup**: `infrastructure/README.md` and `grading-v2/` are docs-only; decide whether to keep or delete. `grading-v2/` is an in-progress redesign that may or may not be your current direction.
5. **Per-sport integrity split** when MLB and NFL ETLs both run successfully and you can see what `mlb.*` / `nfl.*` tables need vs. what's shared.

## How to continue (next session)

1. Read MEMORY.md, then LEARNED.md.
2. The first thing to verify is whether the manual actions above were done. `gh secret list --repo SchnappAPI/schnapp-bet` should show `OP_SERVICE_ACCOUNT_TOKEN`. If not, that's the blocker.
3. Once secrets are wired and the runner registered, trigger `nba-etl.yml` and walk the failure modes — workflows often surface env / path issues that are invisible during a paper port.

## Blockers

None for porting. The runtime blockers are the manual actions above.

## Recommendation

This session shipped a lot. Next session should be small: kick off one workflow, fix the first thing that breaks, repeat. Don't combine integration debugging with new ports.
