# services/launchd/

launchd agents and the wrapper script that sources secrets from 1Password.

## Why a wrapper

launchd does not source `~/.zshrc`, so `OP_SERVICE_ACCOUNT_TOKEN` is not in a plist's inherited environment. `op-wrap.sh` extracts the token from `~/.zshrc`, exports it, then `exec`s `op run --env-file=.env.template -- <command>`. Plists contain zero secret values.

## Contents

- `op-wrap.sh` — bootstrap wrapper (sources `OP_SERVICE_ACCOUNT_TOKEN`, runs `op run`).
- `bet.schnapp.flask.plist` — Flask runner (`services/flask/runner.py`) on port 5000.
- `bet.schnapp.web-prod.plist` — Next.js production server on port 3001.
- `rotate-op-token.sh` — rotate `OP_SERVICE_ACCOUNT_TOKEN` end-to-end. Copy the new token from 1Password (UI → service-account regenerate), then run `bash services/launchd/rotate-op-token.sh`. It reads the token from `pbpaste`, updates `~/.zshrc` and the GitHub repo secret, cycles both launchd agents (which picks up any other vault changes like a new `admin_passcode`), and verifies. Safe to re-run.

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
curl -sf http://127.0.0.1:5000/health     # Flask
curl -sf http://127.0.0.1:3001            # Next.js
```

## What changed from sports-modeling

The sports-modeling plists carried per-secret `EnvironmentVariables` entries in plaintext (SQL connection string, GITHUB_PAT, ODDS_API_KEY, etc.). The schnapp-bet plists carry none of those — they're resolved by `op run` from `.env.template` at process-start time. The only secret that touches disk on this host is `OP_SERVICE_ACCOUNT_TOKEN` in `~/.zshrc`.

## Failure modes

- `~/.zshrc` missing or doesn't export `OP_SERVICE_ACCOUNT_TOKEN` → `op-wrap.sh` exits 1, agent flaps.
- `op` CLI not in PATH (`/usr/local/bin/op` expected) → wrapper exits 1.
- `.env.template` URI references an item or field that no longer exists in `web-variables` vault → `op run` fails for that variable; consumer hits `KeyError` / `process.env.X is undefined`.
- Token rotated in 1Password but `~/.zshrc` still has the old value → all subsequent reads fail until `.zshrc` updated and `launchctl unload/load` cycled.
