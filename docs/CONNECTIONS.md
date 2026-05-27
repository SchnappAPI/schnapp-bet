# Connections

Single source of truth for every external system the project connects to. Secret values live in the `web-variables` 1Password vault; see ADR-20260517-5 and `.env.template` for the full consumer map.

Last verified: 2026-05-27.

## Local SQL Server (Schnapps-MBP, canonical ETL target)

SQL Server 2022 in Docker (Colima) on Schnapps-MBP. Target for all mac-runner workflows and ad-hoc DB queries.

- Container: `mssql`, port `localhost,1433`
- Database: `schnapp-bet`
- Credentials: SA password in `/Users/schnapp/sql-server.env` (sourced by mac-runner workflows)

Ad-hoc queries from a session: write a Python script to `/tmp/` via Mac MCP `shell_exec`, execute with `/Users/schnapp/venv/bin/python`. Use pyodbc with `server=localhost,1433`, `database=schnapp-bet`, `uid=sa`, password from `/Users/schnapp/sql-server.env`, and `TrustServerCertificate=yes`.

The local container does not auto-pause. If not running, `docker start mssql` on the Mac (Colima must be running first: `colima start`).

## Web tier (Mac, production)

`https://schnapp.bet` and `https://www.schnapp.bet` are served by launchd user agent `bet.schnapp.web-prod`, plist at `~/Library/LaunchAgents/bet.schnapp.web-prod.plist`. Runs `next start -H 127.0.0.1 -p 3001` from `/Users/schnapp/code/schnapp-bet/web/` against the existing `web/.next/` build. `RunAtLoad=true`, `KeepAlive=true`. Also reachable as `https://prod.schnapp.bet` (pre-cutover staging hostname alias).

Dev mode is not auto-managed — run `op run --env-file=../.env.template -- npm run dev` from `web/` interactively when needed. The retired `bet.schnapp.web` launchd agent is no longer installed.

Plist env vars (resolved at process-start by `op-wrap.sh` per ADR-20260517-5):

- `SQL_CONNECTION_STRING` — `Server=localhost,1433;Database=schnapp-bet;User Id=sa;Password=<SA password from /Users/schnapp/sql-server.env>;Encrypt=true;TrustServerCertificate=true;`
- `ADMIN_PASSCODE` — gates `/admin` and authorizes the `x-admin-token` path on workflow-dispatching routes
- `AUTH_TOKEN_SECRET` — session token signing
- `ADMIN_REFRESH_CODE` — alternate auth code for the body-auth path on `/api/refresh-data`
- `RUNNER_URL` — consumed by `/api/scoreboard`, `/api/games`, `/api/live-boxscore`
- `RUNNER_API_KEY` — `X-Runner-Key` header on Flask calls
- `GITHUB_PAT` — fine-grained PAT. Used by `/api/refresh-data` and `/api/refresh-lines` to dispatch workflows. Stored in vault; resolved via `op-wrap.sh` at process start.
- `ODDS_API_KEY` — consumed by `web/app/api/live-props/route.ts`

Restart: `launchctl kickstart -k gui/$UID/bet.schnapp.web-prod`.

Deploy: manual `deploy-web.yml` workflow (workflow_dispatch) on mac-runner. Clones from GitHub, builds, restarts `bet.schnapp.web-prod`, smoke-tests port 3001. No CI deploy on push to main.

## GitHub Actions

- Repo: `SchnappAPI/schnapp-bet` (private)
- Default branch: `main`
- Self-hosted runner: `mac-runner-1` (label `mac-runner`) on Schnapps-MBP, launchd agent `actions.runner.SchnappAPI-schnapp-bet.mac-runner-1`. `RunAtLoad=true`, `KeepAlive=true`.
- Python venv: `/Users/schnapp/venv` (Python 3.12.13) with `etl/requirements.txt` installed.
- ODBC: Driver 18 for SQL Server (18.6.2.1) + unixODBC 2.3.14 via Microsoft Homebrew tap.

Repository secrets (Settings → Secrets and variables → Actions):

| Secret                      | Notes                                                                              |
| --------------------------- | ---------------------------------------------------------------------------------- |
| `OP_SERVICE_ACCOUNT_TOKEN`  | Bootstrap secret. Workflows use `1password/load-secrets-action@v2` to resolve all other secrets as `op://` URIs from the `web-variables` vault. |
| `secrets.GITHUB_TOKEN`      | Auto-provided. Used for `workflow_run` dispatch with `permissions: actions: write`. |

All other runtime secrets (`SQL_*`, `ODDS_API_KEY`, `NBA_PROXY_URL`, etc.) are declared as `op://web-variables/...` URIs in each workflow's `env:` block and resolved by `load-secrets-action` at run time — they are not stored as GitHub Actions secrets.

## Schnapp Mac MCP

- URL: `https://mac-mcp.schnapp.bet/mcp`
- Tunnel: Cloudflare named tunnel `schnapp-mac`, ID `844a3714-9bd3-409e-a672-a6840c94e68e`. Config at `/etc/cloudflared/config.yml`.
- Service: launchd `com.schnapp.macmcp` (`RunAtLoad=true`, `KeepAlive=true`). Code at `/Users/schnapp/mac-mcp/server.py` (FastMCP). Venv `/Users/schnapp/mac-mcp/venv`.

Tools (10): `flask_status`, `flask_restart`, `live_scoreboard`, `live_boxscore`, `workflow_trigger`, `workflow_status` (uses `GH_PAT`), `shell_exec`, `read_file`, `write_file` (require `MAC_MCP_AUTH_TOKEN` parameter), `mac_info`.

Secrets: resolved via `op-wrap.sh` + a service-local `.env.template` in `/Users/schnapp/mac-mcp/` for MCP-specific vars (`MAC_MCP_AUTH_TOKEN`, `GH_PAT`, etc.). No plaintext credentials in the plist.

Recovery: 1) tunnel — `sudo launchctl kickstart -k system/com.cloudflare.cloudflared`. 2) MCP — `launchctl bootout gui/501/com.schnapp.macmcp && launchctl bootstrap gui/501 ~/Library/LaunchAgents/com.schnapp.macmcp.plist`.

## Flask Runner (Mac)

- Service: launchd `bet.schnapp.flask`. Code `services/flask/runner.py`. Bind `0.0.0.0:5000`.
- Public: `https://mac-flask.schnapp.bet` (via `schnapp-mac` tunnel).
- Endpoints: `GET /ping` (no auth), `GET /scoreboard` (X-Runner-Key), `GET /boxscore?gameId=` (X-Runner-Key).
- Auth: `X-Runner-Key` matches `RUNNER_API_KEY` env var (set in plist).
- Restart: `launchctl kickstart -k gui/$UID/bet.schnapp.flask` (or Mac MCP `flask_restart`).

## Cloudflare

| Subdomain                        | Backend                                    | Proxy  | Status                                                                                          |
| -------------------------------- | ------------------------------------------ | ------ | ----------------------------------------------------------------------------------------------- |
| `schnapp.bet`, `www.schnapp.bet` | Mac Next.js prod `:3001` via `schnapp-mac` | Orange | live                                                                                            |
| `prod.schnapp.bet`               | Same as above (alias)                      | Orange | live                                                                                            |
| `dev.schnapp.bet`                | Mac Next.js dev `:3000` via `schnapp-mac`  | Orange | route still live; backend only when `next dev` is running interactively (no auto-managed agent) |
| `mac-flask.schnapp.bet`          | Mac Flask `:5000` via `schnapp-mac`        | Orange | live                                                                                            |
| `mac-mcp.schnapp.bet`            | Mac MCP `:8765` via `schnapp-mac`          | Orange | live                                                                                            |

All Schnapp subdomains are Cloudflare-proxied (orange cloud). Do not flip any to DNS-only.

## External APIs

### NBA Stats API (stats.nba.com)

- Webshare rotating residential proxy required from GitHub Actions IPs (`NBA_PROXY_URL` secret).
- PT stats (`leaguedashptstats`) do not require proxy.

### NBA CDN (cdn.nba.com)

- Public. Used for live scoreboard and box scores via Flask `/scoreboard` and `/boxscore`.

### MLB Stats API (statsapi.mlb.com)

- Public. Main game endpoint: `/api/v1/game/{gameID}/withMetrics`.

### Baseball Savant (baseballsavant.mlb.com)

- Public. Source for Statcast pitch-level data and career BvP.

### The Odds API (api.the-odds-api.com)

- `ODDS_API_KEY` secret. FanDuel only (`bookmakers=fanduel`). See `docs/decisions/ADR-20260420-3-fanduel-only.md`.

### nflverse via nflreadpy (NFL)

- Public, no auth. `nflreadpy` 0.1.5. `update_config(cache_mode='off')` at top of every ETL run (GitHub Actions runners have no persistent filesystem).

## Local development

- **Schnapps-MBP**: primary host. Python 3.12 venv at `/Users/schnapp/venv`. ODBC Driver 18 + unixODBC. SQL credentials at `/Users/schnapp/sql-server.env`. Hosts mac-runner-1. Production web `:3001`, Flask `:5000`, Mac MCP `:8765`. Dev mode `:3000` is interactive-only, not auto-managed.

## Claude Code on Mac

- Hostname: `Schnapps-MBP`, user: `schnapp`. `claude` CLI 2.1.126 on PATH. `gh` CLI 2.92.0 at `/usr/local/bin/gh`. Authenticated via 1Password plugin (`~/.config/op/plugins.sh` aliases `gh` to `op plugin run -- gh`; biometric unlock, no stored token).

OAuth token (`CLAUDE_CODE_OAUTH_TOKEN`): minted via `claude setup-token`, 1-year expiry, stored as a GitHub Actions repo secret. Consumed by `.github/workflows/claude.yml` (if/when added) to authenticate `anthropics/claude-code-action@v1`. Rotation:

1. Revoke at `https://console.anthropic.com`.
2. `claude setup-token` on the Mac; copy new value.
3. `gh secret set CLAUDE_CODE_OAUTH_TOKEN --repos schnappapi/schnapp-bet`.
