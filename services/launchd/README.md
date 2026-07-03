# services/launchd/

launchd agents and the wrapper script that sources secrets from 1Password.

## Token bootstrap chain

Two components cooperate to make `OP_SERVICE_ACCOUNT_TOKEN` available to all launchd-managed services:

1. **`com.schnapp.environment`** (`~/Library/LaunchAgents/com.schnapp.environment.plist`, _not in this repo_): runs at login via `RunAtLoad=true`. Sources `~/.zshenv` and calls `launchctl setenv OP_SERVICE_ACCOUNT_TOKEN "$OP_SERVICE_ACCOUNT_TOKEN"`, injecting the token into the launchd environment so every subsequent service load inherits it.

2. **`op-wrap.sh`** (in this repo): each service plist invokes this wrapper as the first `ProgramArguments` entry. It independently reads `OP_SERVICE_ACCOUNT_TOKEN` from `~/.zshrc` via grep, exports it, then execs `op run --env-file=<repo-root>/.env.template -- <real command>`. This resolves all `op://` URIs in `.env.template` and injects them as environment variables before the service process starts. If the service's working directory also contains a `.env.template`, that file is layered on top (`--env-file=<global> --env-file=<local>`), allowing per-service secrets without polluting the repo-root template.

Both mechanisms are belt-and-suspenders. `op-wrap.sh` does not assume `com.schnapp.environment` has run — it always re-reads `~/.zshrc` directly. Plists contain zero secret values.

## Contents (this repo)

- `op-wrap.sh` — bootstrap wrapper (reads `OP_SERVICE_ACCOUNT_TOKEN` from `~/.zshrc`, execs `op run`).
- `bet.schnapp.flask.plist` — Flask runner (`services/flask/runner.py`) on port 5000.
- `bet.schnapp.web-prod.plist` — Next.js production server on port 3001.
- `rotate-op-token.sh` — rotate `OP_SERVICE_ACCOUNT_TOKEN` end-to-end. Copy the new token from 1Password (UI → service-account regenerate), then run `bash services/launchd/rotate-op-token.sh`. It reads the token from `pbpaste`, updates `~/.zshrc` and `~/.zshenv`, updates the GitHub repo secret, cycles all launchd agents, and verifies. Safe to re-run.

## Other managed services (not in this repo)

The following services also use `op-wrap.sh` but live outside this repo:

- `com.schnapp.macmcp` (`~/Library/LaunchAgents/com.schnapp.macmcp.plist`) — Mac MCP server at `/Users/schnapp/mac-mcp/`. Uses `op-wrap.sh` + a local `.env.template` in the service directory for MCP-specific secrets.
- `com.schnapp.githubmcp` (`~/Library/LaunchAgents/com.schnapp.githubmcp.plist`) — GitHub MCP server at `/Users/schnapp/github-mcp/`. Same pattern.

## Install / refresh

```bash
# From repo root:
cp services/launchd/bet.schnapp.flask.plist ~/Library/LaunchAgents/
cp services/launchd/bet.schnapp.web-prod.plist ~/Library/LaunchAgents/

# Unload any prior versions, then load the new ones.
launchctl unload ~/Library/LaunchAgents/bet.schnapp.flask.plist 2>/dev/null
launchctl unload ~/Library/LaunchAgents/bet.schnapp.web-prod.plist 2>/dev/null

launchctl load ~/Library/LaunchAgents/bet.schnapp.flask.plist
launchctl load ~/Library/LaunchAgents/bet.schnapp.web-prod.plist
```

## Verify

```bash
# Are the agents loaded?
launchctl list | grep bet.schnapp

# Did op-wrap resolve secrets correctly?
tail /Users/schnapp/code/schnapp-bet/services/flask/flask.err.log
tail /Users/schnapp/code/schnapp-bet/web/web-prod.err.log

# Quick liveness:
curl -sf http://127.0.0.1:5000/ping       # Flask
curl -sf http://127.0.0.1:3001            # Next.js
```

## What changed from sports-modeling

The sports-modeling plists carried per-secret `EnvironmentVariables` entries in plaintext (SQL connection string, GITHUB_PAT, ODDS_API_KEY, etc.). The schnapp-bet plists carry none of those — they're resolved by `op run` from `.env.template` at process-start time. The only secret that touches disk on this host is `OP_SERVICE_ACCOUNT_TOKEN` in `~/.zshrc` and `~/.zshenv`.

## Failure modes

- `~/.zshrc` missing or doesn't export `OP_SERVICE_ACCOUNT_TOKEN` → `op-wrap.sh` exits 1, agent flaps.
- `~/.zshenv` missing or doesn't export `OP_SERVICE_ACCOUNT_TOKEN` → `com.schnapp.environment` silently injects an empty value; `op-wrap.sh` is unaffected (it reads `~/.zshrc` independently).
- `com.schnapp.environment` not loaded (e.g. first boot before login) → services still work because `op-wrap.sh` reads `~/.zshrc` directly.
- `op` CLI not in PATH (`/usr/local/bin/op` expected) → wrapper exits 1.
- `.env.template` URI references an item or field that no longer exists in `web-variables` vault → `op run` fails for that variable; consumer hits `KeyError` / `process.env.X is undefined`.
- Token rotated in 1Password but `~/.zshrc` / `~/.zshenv` still have the old value → all subsequent reads fail until both files are updated and affected agents are cycled (`launchctl kickstart -k`).
