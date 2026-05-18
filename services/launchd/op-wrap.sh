#!/bin/bash
# services/launchd/op-wrap.sh — bootstrap wrapper for launchd-managed services.
#
# launchd does not source ~/.zshrc, so OP_SERVICE_ACCOUNT_TOKEN is not present
# in a plist's inherited environment. This wrapper extracts the token from
# ~/.zshrc, exports it, then `op run` resolves the rest of .env.template at
# command time.
#
# Usage in a plist's ProgramArguments:
#   <array>
#       <string>/Users/schnapp/code/schnapp-bet/services/launchd/op-wrap.sh</string>
#       <string>/Users/schnapp/venv/bin/python</string>
#       <string>services/flask/runner.py</string>
#   </array>
#
# The wrapper:
#   1. Sources OP_SERVICE_ACCOUNT_TOKEN from ~/.zshrc (the single bootstrap
#      secret per ADR-20260517-5).
#   2. cd's to the repo root.
#   3. Exec's `op run --env-file=.env.template -- "$@"`.
#
# Failure modes:
#   - ~/.zshrc missing or no OP_SERVICE_ACCOUNT_TOKEN export → exit 1.
#   - op binary missing → exit 1.
#   - .env.template missing → op run reports and exits.

set -euo pipefail

REPO_ROOT="/Users/schnapp/code/schnapp-bet"
ZSHRC="$HOME/.zshrc"

if [ ! -f "$ZSHRC" ]; then
  echo "op-wrap: $ZSHRC not found" >&2
  exit 1
fi

TOKEN_LINE=$(grep '^export OP_SERVICE_ACCOUNT_TOKEN=' "$ZSHRC" || true)
if [ -z "$TOKEN_LINE" ]; then
  echo "op-wrap: OP_SERVICE_ACCOUNT_TOKEN not found in $ZSHRC" >&2
  exit 1
fi

export OP_SERVICE_ACCOUNT_TOKEN="${TOKEN_LINE#export OP_SERVICE_ACCOUNT_TOKEN=}"

if ! command -v op >/dev/null 2>&1; then
  echo "op-wrap: 'op' CLI not found in PATH" >&2
  exit 1
fi

cd "$REPO_ROOT"
exec op run --env-file=.env.template -- "$@"
