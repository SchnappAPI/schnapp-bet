# Runbook: Mac-runner, Flask, MCP

Three launchd user agents on Schnapps-MBP provide the project's automation surface beyond the web tier:

- `actions.runner.SchnappAPI-schnapp-bet.mac-runner-1` — GitHub Actions self-hosted runner. Drives all `runs-on: mac-runner` workflows.
- `bet.schnapp.flask` — Flask live-data runner on `0.0.0.0:5000`. Proxies NBA CDN data to the web tier.
- `com.schnapp.macmcp` — Mac MCP server on `127.0.0.1:8765`. FastMCP, 10 tools.

All three have `RunAtLoad=true` and `KeepAlive=true`. Launchd respawns on crash.

## Status checks

```bash
launchctl list | grep -E 'actions.runner|bet.schnapp|com.schnapp'
```

Returns one line per agent. PID 0 means the agent is registered but not running.

Via Mac MCP:
- `flask_status` tool — returns `{"ok": true}` if `/ping` succeeds via the tunnel.
- `mac_info` tool — hostname, OS, disk, uptime, Docker state.

## Mac-runner

- Plist: `~/Library/LaunchAgents/actions.runner.SchnappAPI-schnapp-bet.mac-runner-1.plist`
- Labels: `self-hosted`, `macOS`, `X64`, `mac-runner`
- Logs: `~/Library/Logs/actions.runner.SchnappAPI-schnapp-bet.mac-runner-1/`
- Python venv: `/Users/schnapp/venv` (Python 3.12.13) with `etl/requirements.txt` installed
- ODBC: Driver 18 for SQL Server (18.6.2.1) + unixODBC 2.3.14

Restart:
```bash
launchctl bootout user/$(id -u) actions.runner.SchnappAPI-schnapp-bet.mac-runner-1
launchctl bootstrap user/$(id -u) ~/Library/LaunchAgents/actions.runner.SchnappAPI-schnapp-bet.mac-runner-1.plist
```

If a workflow shows "no available runners," confirm the agent is loaded and that the runner registration in GitHub Settings → Actions → Runners shows status `online`. A new runner registration token may be required after a long outage.

## Flask runner

- Plist: `~/Library/LaunchAgents/bet.schnapp.flask.plist`
- Code: `services/flask/runner.py`
- Bind: `0.0.0.0:5000`
- Public: `https://mac-flask.schnapp.bet` via the `schnapp-mac` tunnel
- Logs: `services/flask/flask.log` and `flask.err.log`

Restart (no plist change): `launchctl kickstart -k user/$(id -u) bet.schnapp.flask`. Or use the Mac MCP `flask_restart` tool.

Plist change: bootout/bootstrap, not kickstart.

Verify: `curl https://mac-flask.schnapp.bet/ping` returns `{"ok": true}`.

Auth: `X-Runner-Key` header must match `RUNNER_API_KEY` env var (set in plist). `/ping` is unauthenticated by design.

## Mac MCP

- Plist: `~/Library/LaunchAgents/com.schnapp.macmcp.plist`
- Code: `/Users/schnapp/mac-mcp/server.py`
- Bind: `127.0.0.1:8765`
- Public: `https://mac-mcp.schnapp.bet/mcp` via the `schnapp-mac` tunnel
- Venv: `/Users/schnapp/mac-mcp/venv` (Python 3.12.13, includes `requests 2.33.1`)
- Logs: `/Users/schnapp/mac-mcp/mcp.log` and `mcp.err.log`

Reload after code change to `server.py`:
```bash
launchctl bootout gui/501/com.schnapp.macmcp
launchctl bootstrap gui/501 ~/Library/LaunchAgents/com.schnapp.macmcp.plist
```

Typically completes in <2 seconds.

Plist env: `MAC_MCP_AUTH_TOKEN` (gates `shell_exec` / `read_file` / `write_file`), `RUNNER_API_KEY` (matches Flask), `GH_PAT` (fine-grained PAT for GitHub API tools).

## Cross-service health check

```bash
docker ps | grep mssql                              # SQL container up?
curl -s https://mac-flask.schnapp.bet/ping          # Flask?
curl -s https://mac-mcp.schnapp.bet/mcp             # MCP tunnel?
launchctl list | grep -E 'actions.runner|bet.schnapp|com.schnapp'
```

If the SQL container is not running: `docker start mssql` (Colima must be running first: `colima start`).
