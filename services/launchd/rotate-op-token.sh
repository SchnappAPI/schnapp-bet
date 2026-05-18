#!/bin/bash
# Rotate OP_SERVICE_ACCOUNT_TOKEN: reads new token from clipboard, updates
# ~/.zshrc, pushes to GitHub repo secret, cycles launchd agents (which also
# picks up any new admin_passcode from the vault). Safe to re-run.
#
# Usage: bash /tmp/rotate-op-token.sh

set -euo pipefail

# --- Sanity check the clipboard ---
NEW_OP_TOKEN=$(pbpaste)
if [[ "$NEW_OP_TOKEN" != ops_* ]]; then
  echo "ERROR: clipboard does not contain a 1Password service-account token (expected prefix 'ops_')." >&2
  echo "Re-copy the new token from the 1Password UI, then re-run this script." >&2
  exit 1
fi

# --- Update ~/.zshrc ---
sed -i.bak "s|^export OP_SERVICE_ACCOUNT_TOKEN=.*|export OP_SERVICE_ACCOUNT_TOKEN=$NEW_OP_TOKEN|" "$HOME/.zshrc"
rm "$HOME/.zshrc.bak"
echo "✓ ~/.zshrc updated"

# --- Push to GitHub Actions repo secret ---
echo "$NEW_OP_TOKEN" | gh secret set OP_SERVICE_ACCOUNT_TOKEN --repo SchnappAPI/schnapp-bet
echo "✓ GitHub secret updated"

# --- Cycle launchd agents (picks up new token from .zshrc + new admin_passcode from vault) ---
for plist in bet.schnapp.flask bet.schnapp.web-prod; do
  launchctl unload "$HOME/Library/LaunchAgents/$plist.plist"
  launchctl load   "$HOME/Library/LaunchAgents/$plist.plist"
done
echo "✓ launchd agents cycled"

# Clear token from script memory before verify phase
unset NEW_OP_TOKEN

# --- Verify ---
sleep 3
echo
echo "--- agents (both should show numeric PIDs, not '-') ---"
launchctl list | grep bet.schnapp
echo
echo "--- web (both should be HTTP 200) ---"
curl -s -o /dev/null -w 'web: HTTP %{http_code}\n' http://127.0.0.1:3001
curl -s -o /dev/null -w 'api: HTTP %{http_code}\n' http://127.0.0.1:3001/api/ping
echo
echo "--- 1Password (should list web-variables) ---"
OP_SERVICE_ACCOUNT_TOKEN=$(grep '^export OP_SERVICE_ACCOUNT_TOKEN=' "$HOME/.zshrc" | cut -d= -f2-) op vault list

# --- Clear clipboard ---
echo -n '' | pbcopy
echo
echo "✓ Clipboard cleared. Done."
echo
echo "Note: any other terminal tab you have open still has the OLD token in its environment."
echo "      Run 'source ~/.zshrc' there (or open a new tab) before using 'op' commands."
