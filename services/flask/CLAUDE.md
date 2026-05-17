# services/flask/CLAUDE.md

Flask service providing live NBA CDN data to the web tier. Runs as launchd agent
`bet.schnapp.flask` on Schnapps-MBP. Public at `https://mac-flask.schnapp.bet`.

## What lives here

- `runner.py` — the Flask app. Routes: `/ping`, `/scoreboard`, `/boxscore/<game_id>`.
- Logs: `services/flask/flask.log`, `services/flask/flask.err.log` (on Mac, not in git).

## Rules

- This service has no database connection and writes no data. It is a proxy to the NBA CDN.
- `RUNNER_API_KEY` gates all routes except `/ping`. Read from env via the launchd plist.
  Never hardcode it.
- NBA CDN base URL: `https://cdn.nba.com/static/json/liveData/`. No proxy needed.
- To reload after a plist change: `launchctl bootout user/$(id -u) bet.schnapp.flask`
  then `launchctl bootstrap user/$(id -u) ~/Library/LaunchAgents/bet.schnapp.flask.plist`.
  Do not use `kickstart -k` for plist reloads; it does not re-read the plist.
- To restart without a plist change: `launchctl kickstart -k user/$(id -u) bet.schnapp.flask`.
- Verify after restart: `curl https://mac-flask.schnapp.bet/ping` should return `{"ok":true}`.
- Log tail: `tail -f ~/services/flask/flask.log` via Mac MCP shell_exec.
