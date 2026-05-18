# Infrastructure

**STATUS:** live.

## Purpose

Documents the compute, networking, and integration layer that underlies all sports: the Mac (Schnapps-MBP) hosts everything — self-hosted GitHub Actions runner, Next.js production web tier (`bet.schnapp.web-prod` on `127.0.0.1:3001` behind Cloudflare proxy at `schnapp.bet`), Schnapp Mac MCP, Cloudflare tunnel, Flask live-data runner, and the SQL Server 2022 Docker container (canonical database for both ETL and web). Credentials and endpoints are centralized in `/docs/CONNECTIONS.md`.

## Files

Infrastructure-relevant code and config:

- `mcp/server.py` - FastMCP server for the (now-decommissioned) VM Schnapp Ops MCP. Kept for reference; the Mac MCP at `/Users/schnapp/mac-mcp/server.py` reached tool-surface parity 2026-04-27 and serves the live `https://mac-mcp.schnapp.bet/mcp` connector
- `services/flask/runner.py` - Flask live-data service. Now run by the Mac launchd agent `bet.schnapp.flask` at `127.0.0.1:5000` (was previously the VM `schnapp-flask` systemd unit; moved from `etl/runner.py` in MONOREPO_PLAN Step 4)
- `.github/workflows/*.yml` - all automation, 39 workflows total: 30 on `mac-runner`, 9 on GitHub-hosted `ubuntu-latest`

Operational runbooks will live in `/infrastructure/runbooks/` as they are authored. None yet.

## Key Concepts

### Self-hosted runner (Mac)

`mac-runner-1` on Schnapps-MBP. Status: **production** as of 2026-04-27. Drives the entire workflow cadence; the VM runner is deleted.

- Host: Schnapps-MBP, Intel i7-6820HQ, 16 GiB RAM, macOS 14.8.5 (OCLP), user `schnapp`
- Runner version 2.334.0 at `/Users/schnapp/actions-runner/`
- Labels: `self-hosted`, `macOS`, `X64`, `mac-runner` (custom)
- Launchd user agent: `~/Library/LaunchAgents/actions.runner.SchnappAPI-sports-modeling.mac-runner-1.plist`, `RunAtLoad` and `KeepAlive` both set; launchd respawns the listener after a crash
- Logs: `~/Library/Logs/actions.runner.SchnappAPI-sports-modeling.mac-runner-1/`
- Python venv: `/Users/schnapp/venv` (Python 3.12.13) with full `etl/requirements.txt` installed
- ODBC: Driver 18 for SQL Server (18.6.2.1) + unixODBC 2.3.14 via Microsoft Homebrew tap

The Mac runner runs all 29 active workflows, split into two groups:

1. **Mac-local workflows** (5): source `/Users/schnapp/sql-server.env` directly for SA credentials. Workflows: `mac-runner-pilot.yml` (read-only `etl/local_db_inventory.py`), `db_inventory-mac.yml`, `odds-etl-mac.yml` (manual dispatch only, no schedule), `compute-patterns-mac.yml`, and `nba-game-day-mac.yml` (multi-step: gate, nba_live, odds_etl --mode upcoming, grade_props --mode intraday, lineup_poll, and optionally grade_props --mode outcomes when `skip_gate=true`).

2. **Standard workflows** (24): read `SQL_*` from GitHub Actions repo secrets (all pointing to `localhost,1433`). Subdivided:
   - **Read-only / idempotent manual** (8): `db_inventory.yml`, `diagnose-corpus.yml`, `validate-integrity-catalog.yml`, `investigate-integrity-findings.yml`, `verify-tier-rows.yml`, `bootstrap-integrity.yml`, `retroactive-scan.yml`, `keepalive.yml`.
   - **Write-path / cost-bearing manual** (7): `cleanup-stale-odds.yml`, `compute-grade-outcomes.yml`, `check-backfill-progress.yml`, `grading.yml`, `nba-backfill.yml`, `refresh-data.yml`, `signal-backtest.yml`, `mlb-pbp-etl.yml`.
   - **Scheduled** (9): `compute-patterns.yml` (07:30 UTC), `mlb-etl.yml` (09:00 UTC), `nba-etl.yml` (09:00 UTC), `nba-game-day.yml` (09:30 UTC + */15 0-6 UTC + */15 22-23 UTC), `nfl-etl.yml` (Tue 09:00 UTC), `odds-backfill-weekly.yml` (Mon 11:00 UTC), `odds-etl.yml` (10:00 UTC; triggers `grading.yml` via `workflow_run`), `refresh-lines.yml` (17/20/23 UTC), `weekly-calibration.yml` (Sun 06:00 UTC).



### Mac-hosted parallel website (`dev.schnapp.bet`)

Live as of 2026-04-26. A complete second copy of the consumer site, hosted from Schnapps-MBP, targeting the local SQL Server container.

- `bet.schnapp.web` launchd user agent (`~/Library/LaunchAgents/bet.schnapp.web.plist`, `RunAtLoad=true`, `KeepAlive=true`) runs `next start -H 127.0.0.1 -p 3000` from `/Users/schnapp/sports-modeling/web` against the local SQL Server container at `localhost,1433`. All six web env vars are set in the plist's `EnvironmentVariables` block, including `RUNNER_URL=http://127.0.0.1:5000` and `RUNNER_API_KEY=runner-Lake4971` so the three Flask-calling routes target the local Mac Flask. Logs at `web/web.log` and `web/web.err.log`.
- `bet.schnapp.flask` launchd user agent (`~/Library/LaunchAgents/bet.schnapp.flask.plist`, same launchd flags) runs `services/flask/runner.py` unmodified under `/Users/schnapp/venv/bin/python`, listening on `0.0.0.0:5000`. Auth via `RUNNER_API_KEY=runner-Lake4971`. Mac venv added Flask 3.1.3 via `pip install flask`. Logs at `services/flask/flask.log` and `services/flask/flask.err.log`.
- Cloudflare DNS: `dev.schnapp.bet` (proxied) and `mac-flask.schnapp.bet` (proxied) routed through the existing `schnapp-mac` tunnel (ID `844a3714-9bd3-409e-a672-a6840c94e68e`) via `cloudflared tunnel route dns`.
- Cloudflare ingress (`/etc/cloudflared/config.yml`): `dev.schnapp.bet -> http://127.0.0.1:3000`.

Three Next.js routes (`api/scoreboard`, `api/live-boxscore`, `api/games`) read `RUNNER_URL` and `RUNNER_API_KEY` from `process.env`. The fallback literal (`https://live.schnapp.bet`) is dead code in production — `live.schnapp.bet` DNS was deleted 2026-05-01. Production always has an explicit `RUNNER_URL=https://mac-flask.schnapp.bet` in the plist. See commit `faa4d4b`.

Local DB note: the BACPAC import that populated `sports-modeling` on the Mac container carried `common.feature_flags.maintenance_mode = 1` (production was in maintenance during that snapshot per ADR-20260426-1). Flipped to 0 on the Mac container only.

### Flask live-data runner (Mac, production since 2026-04-27)

`services/flask/runner.py` run by the Mac launchd agent `bet.schnapp.flask`. Listens on `0.0.0.0:5000`. Public hostname: `https://mac-flask.schnapp.bet` (Cloudflare-proxied through the `schnapp-mac` tunnel).

- `GET /ping` - health. **No auth.** Returns `{"ok": true}`. Used by the Mac MCP `flask_status` tool.
- `GET /scoreboard` - today's game statuses from `cdn.nba.com/static/json/liveData/scoreboard/todaysScoreboard_00.json`. Requires `X-Runner-Key` header. Returns `{ games: [...] }` with `gameStatus` 1 (upcoming), 2 (live), 3 (final).
- `GET /boxscore?gameId=` - live player stats + score, directly from `cdn.nba.com/static/json/liveData/boxscore/boxscore_{gameId}.json`. Requires `X-Runner-Key` header.

Auth: `X-Runner-Key: runner-Lake4971` matches `RUNNER_API_KEY` env var. Enforced on `/scoreboard` and `/boxscore` only; `/ping` is open so external health-check callers can hit it without a secret.

Production web routes reach this Flask via plist env `RUNNER_URL=https://mac-flask.schnapp.bet` and `RUNNER_API_KEY=runner-Lake4971`. Both CDN sources are public; `NBA_PROXY_URL` is not used by the runner.

### Schnapp Mac MCP server

`/Users/schnapp/mac-mcp/server.py`, FastMCP, port 8765 bound to `127.0.0.1`. Launchd user agent `com.schnapp.macmcp` (`~/Library/LaunchAgents/com.schnapp.macmcp.plist`, `RunAtLoad=true`, `KeepAlive=true`). Exposed through the `schnapp-mac` Cloudflare tunnel at `https://mac-mcp.schnapp.bet/mcp`.

Tools (10): the four original Mac tools (`shell_exec`, `read_file`, `write_file`, `mac_info`) plus six ported from the VM MCP on 2026-04-27 (`flask_status`, `flask_restart`, `live_scoreboard`, `live_boxscore`, `workflow_trigger`, `workflow_status`). `flask_status` / `flask_restart` operate on the Mac `bet.schnapp.flask` launchd agent via `launchctl list` and `launchctl kickstart -k gui/$UID/bet.schnapp.flask` (no sudo needed -- it is a user agent). `live_scoreboard` and `live_boxscore` hit the Mac Flask at `http://localhost:5000`. `workflow_trigger` / `workflow_status` use the GitHub REST API with `GH_PAT`.

MCP venv: `/Users/schnapp/mac-mcp/venv` (Python 3.12.13). `requests 2.33.1` was added on 2026-04-27 for the new HTTP-bearing tools. Plist env vars: `MAC_MCP_AUTH_TOKEN` (gates `shell_exec` / `read_file` / `write_file`), `RUNNER_API_KEY=runner-Lake4971` (matches Mac Flask), `GH_PAT` (fine-grained PAT, same value as `/Users/schnapp/.git-credentials`). Service reload: `launchctl bootout gui/501/com.schnapp.macmcp && launchctl bootstrap gui/501 ~/Library/LaunchAgents/com.schnapp.macmcp.plist`. Logs at `/Users/schnapp/mac-mcp/mcp.log` and `mcp.err.log`.

Tool surface parity with the VM Schnapp Ops MCP was reached on 2026-04-27 (and the VM MCP was decommissioned the same day). The Mac MCP is the sole operational MCP for Schnapp infrastructure going forward.

### Cloudflare subdomains

| Subdomain | Backend | Purpose | Status |
|-----------|---------|---------|--------|
| `schnapp.bet`, `www.schnapp.bet` | Mac Next.js prod on `127.0.0.1:3001` via `schnapp-mac` tunnel | Customer-facing web | **live** |
| `prod.schnapp.bet` | Mac Next.js prod on `127.0.0.1:3001` via `schnapp-mac` tunnel | Pre-cutover staging hostname; redundant with apex now, kept as explicit Mac alias | live |
| `mac-mcp.schnapp.bet` | Mac MCP on `127.0.0.1:8765` via `schnapp-mac` tunnel | Claude.ai MCP connector | live |
| `mac-flask.schnapp.bet` | Mac Flask on `127.0.0.1:5000` via `schnapp-mac` tunnel | Web app live-data routes (`/api/games`, `/api/scoreboard`, `/api/live-boxscore`) | live |
| `dev.schnapp.bet` | Mac Next.js dev on `127.0.0.1:3000` via `schnapp-mac` tunnel | Mac-hosted parallel website against local SQL container (Phase 0) | live |

All Schnapp subdomains are **Cloudflare-proxied** (orange cloud). Cloudflare terminates SSL at the edge and forwards to the `schnapp-mac` tunnel.

### Failure modes and recovery

- Mac tunnel down (`mac-mcp.schnapp.bet` etc returning 502 from cloudflared edge): on the Mac, `sudo launchctl kickstart -k system/com.cloudflare.cloudflared`
- Mac runner offline: `launchctl list actions.runner.SchnappAPI-sports-modeling.mac-runner-1`. `RunAtLoad=true` and `KeepAlive=true` on the plist mean launchd respawns the listener after a crash
- Mac MCP out of date after code change: edit `/Users/schnapp/mac-mcp/server.py`, then `launchctl bootout gui/501/com.schnapp.macmcp && launchctl bootstrap gui/501 ~/Library/LaunchAgents/com.schnapp.macmcp.plist`
- Mac Flask out of date after code change: edit `services/flask/runner.py`, then `launchctl bootout gui/$UID/bet.schnapp.flask && launchctl bootstrap gui/$UID ~/Library/LaunchAgents/bet.schnapp.flask.plist` (or use the `flask_restart` MCP tool)
- Local SQL container not running: `docker start mssql` on the Mac (Colima must be running first: `colima start`) — affects both ETL and web

### Web tier — Mac (production since 2026-04-27)

Two launchd user agents run the same Next.js codebase out of `/Users/schnapp/sports-modeling/web/`, against different DBs, on different ports:

| Plist | Port | DB target | Public hostname | Purpose |
|---|---|---|---|---|
| `bet.schnapp.web` | 3000 | local SQL container | `dev.schnapp.bet` | dev/staging copy |
| `bet.schnapp.web-prod` | 3001 | local SQL container | `schnapp.bet` + `www.schnapp.bet` (+ `prod.schnapp.bet` alias) | production |

Both plists have `RunAtLoad=true`, `KeepAlive=true`. Both run `next start -H 127.0.0.1 -p <port>` against the shared `web/.next/` build directory. Restart: `launchctl kickstart -k gui/$UID/bet.schnapp.web-prod` (or the dev label).

Plist env (both `bet.schnapp.web-prod.plist` and `bet.schnapp.web.plist` are identical except `RUNNER_URL`):
- `SQL_CONNECTION_STRING=Server=localhost,1433;Database=sports-modeling;User Id=sa;Password=...;Encrypt=true;TrustServerCertificate=true;`
- `RUNNER_URL=https://mac-flask.schnapp.bet` (prod) / `http://127.0.0.1:5000` (dev)
- `RUNNER_API_KEY=runner-Lake4971`
- `GITHUB_PAT` -- the same fine-grained PAT used by `/Users/schnapp/.git-credentials` and the Mac MCP plist's `GH_PAT`. Required by `/api/refresh-data` to dispatch `refresh-data.yml` on the Mac runner. Was missing in initial plist creation; added 2026-04-27.
- `ADMIN_PASSCODE`, `AUTH_TOKEN_SECRET`, `ODDS_API_KEY`, `ADMIN_REFRESH_CODE`

Logs at `/Users/schnapp/sports-modeling/web/web-prod.log` and `web-prod.err.log`.

Build/deploy: `deploy-web.yml` (workflow_dispatch on mac-runner) clones from GitHub, runs `npm ci && npm run build`, restarts `bet.schnapp.web-prod`, and smoke-tests port 3001. There is no CI deploy on push to `main`.

### PWA

- Manifest: `web/public/manifest.json`. Name "Schnapp". Start URL `/nba`. Standalone display
- Service worker: `web/public/sw.js`. Network-first for HTML, cache-first for static assets, never caches API routes
- Icon: `web/public/icon.svg` with `sizes: "any"` covers all modern browsers

### Keep-alive

Uptime Robot monitor `schnapp-bet-ping` is paused as of 2026-04-23. `keepalive.yml` is dispatch-only and should not be rescheduled without making a deliberate decision to reverse the tradeoff.

The web `/api/ping` route runs `SELECT 1` against the production DB; it is available for resuming the monitor if a paying user tier ever requires warm web response times.

### Secrets catalog

GitHub repository secrets, verified by inventory + grep across `.github/workflows/` 2026-04-28:

| Secret | Refs in workflows | Notes |
|---|---|---|
| `SQL_SERVER`, `SQL_DATABASE`, `SQL_USERNAME`, `SQL_PASSWORD` | 24 each | all target `localhost,1433` on Schnapps-MBP |
| `ODDS_API_KEY` | 10 | consumed |
| `NBA_PROXY_URL` | 6 | consumed |
| `GH_PAT` | 0 | **ORPHAN** — no workflow references it. Safe to delete from GitHub Settings → Secrets. The PAT value lives in Mac plists; not lost by deleting the Actions secret. |
| `MCP_AUTH_TOKEN` | 0 | **ORPHAN** — consuming workflow was deleted. Safe to delete. |

Auto-provided by GitHub Actions on every run (not configured): `secrets.GITHUB_TOKEN` — used by `grading.yml` redispatch and `nba-game-day.yml` "Dispatch backfill" step (with `permissions: actions: write` at the job level).

Reserved prefix note: GitHub will not accept new secrets starting with `GITHUB_`. The Mac web plists use the env-var name `GITHUB_PAT` directly (in plist scope, not as an Actions secret).

## Invariants

- ETL secrets live in GitHub repository secrets, the Mac launchd plist `EnvironmentVariables` block, or `/Users/schnapp/sql-server.env`. Never hardcoded
- Web routes that call Flask use `process.env.RUNNER_URL` (default `https://live.schnapp.bet` is dead code — DNS deleted 2026-05-01; production always sets it to `https://mac-flask.schnapp.bet`). Never hardcode IPs or hostnames in web code
- Changes to `/Users/schnapp/mac-mcp/server.py` require manual reload: `launchctl bootout gui/501/com.schnapp.macmcp && launchctl bootstrap gui/501 ~/Library/LaunchAgents/com.schnapp.macmcp.plist`
- `cloudflared` runs as the Mac system-level launchd job; recovery is `sudo launchctl kickstart -k system/com.cloudflare.cloudflared`
- Mac runner launchd plist (`actions.runner.SchnappAPI-sports-modeling.mac-runner-1`) has `RunAtLoad=true` and `KeepAlive=true`; launchd respawns the listener on crash
- Mac Flask listens on `0.0.0.0:5000`; Mac MCP binds to `127.0.0.1:8765` only and is exposed via the `schnapp-mac` Cloudflare tunnel
- Flask `/ping` is unauthenticated by design. `/scoreboard` and `/boxscore` require `X-Runner-Key`
- All Schnapp subdomains are Cloudflare-proxied (orange cloud). Do not flip any subdomain to DNS-only
- `keepalive.yml` is dispatch-only. Do not reintroduce a scheduled keep-alive workflow
- Both `bet.schnapp.web` (port 3000) and `bet.schnapp.web-prod` (port 3001) launchd agents share the same `web/.next/` build directory and both target the local SQL container; rebuilding the web app affects both
- Web env vars must match between both web plists for parity (any new env key belongs in BOTH `bet.schnapp.web.plist` and `bet.schnapp.web-prod.plist`)
- BACPAC files retained at `/Users/schnapp/azure-sql-backups/` as portable restore points for `sports-modeling`. Do not delete that directory

## Recent Changes

See `/docs/CHANGELOG.md` filtered by `[infra]`.

## Open Questions

- Whether to formalize runbooks for common operations (Flask restart, tunnel restart, Odds API key rotation)
- Whether to add health-check automation beyond the current Uptime Robot ping
