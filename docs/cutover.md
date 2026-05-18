# Cutover Follow-ups — schnapp-bet

Full first-run cutover landed 2026-05-18. End-to-end smoke verified (`nba-etl.yml` ran on `mac-runner-1`, 1Password resolved every secret, SQL Server received writes). The original four-step cutover (GitHub secret, runner re-registration, launchd plist install, web prod build) is done. The post-cutover housekeeping is also done — see git history for the trail (`git log --grep='ADR-20260517-5'`, `git log --grep='\[meta\]\|\[infra\]'`).

What was done:

- Retired the stale `bet.schnapp.web` dev agent (auto-managed dev mode is gone — run `npm run dev` interactively when needed).
- Deleted `.pre-1password` plist backups (no more plaintext secret files on disk except `~/.zshrc`).
- Renamed all in-repo `sports-modeling` → `schnapp-bet` doc references. The live SQL Server database was already named `schnapp-bet`, so no ALTER DATABASE was required.
- Dropped the `sports-modeling-azure-20260427` backup database (BACPAC files at `/Users/schnapp/azure-sql-backups/` still retained per `.claude/rules/database.md`).
- Fixed the three `web/app/api/refresh-*.ts` routes that still hardcoded `sports-modeling` as the GitHub repo.

What's left:

---

## Rotate `OP_SERVICE_ACCOUNT_TOKEN` (recommended)

The token's full JWT transited a Claude Code conversation transcript during cutover. If transcript-exfiltration or shoulder-surfing is in your threat model, rotate.

```
# 1. In 1Password (web UI): Settings → Developer → Service Accounts → schnapp-automation → Rotate token.
#    Copy the new value (starts with ops_).

NEW_TOKEN='ops_eyJ...'   # paste here

# 2. Replace in ~/.zshrc and reload:
sed -i.bak "s|^export OP_SERVICE_ACCOUNT_TOKEN=.*|export OP_SERVICE_ACCOUNT_TOKEN=$NEW_TOKEN|" ~/.zshrc
rm ~/.zshrc.bak
unset NEW_TOKEN
source ~/.zshrc

# 3. Update the GitHub Actions secret:
echo "$OP_SERVICE_ACCOUNT_TOKEN" | gh secret set OP_SERVICE_ACCOUNT_TOKEN --repo SchnappAPI/schnapp-bet

# 4. Cycle the launchd agents so op-wrap.sh re-reads ~/.zshrc:
launchctl unload ~/Library/LaunchAgents/bet.schnapp.flask.plist
launchctl unload ~/Library/LaunchAgents/bet.schnapp.web-prod.plist
launchctl load   ~/Library/LaunchAgents/bet.schnapp.flask.plist
launchctl load   ~/Library/LaunchAgents/bet.schnapp.web-prod.plist

# 5. Clear shell history (NEW_TOKEN was momentarily in your terminal):
history -c
```

Verify locally:

```
op vault list
```

Expected: lists `web-variables` (proves the new token authenticates).

Verify on GitHub:

```
gh workflow run daily-health-report.yml --repo SchnappAPI/schnapp-bet
sleep 5
RUN_ID=$(gh run list --repo SchnappAPI/schnapp-bet --workflow daily-health-report.yml --limit 1 --json databaseId --jq '.[0].databaseId')
gh run watch --repo SchnappAPI/schnapp-bet "$RUN_ID"
```

Expected: the "Load secrets from 1Password" step succeeds. That's the signal that confirms the GH-side rotation worked.

The old token is invalidated the moment you rotate in the 1Password UI; any system still using it (e.g. a forgotten cron or a different repo's runner) will start failing — which is the point.

While you're in the vault, consider also rotating `ADMIN_PASSCODE` in the `Web App` item — the value (`Sports#2026`) was previously stored plaintext in launchd plists and in an old Azure SQL connection string (the .pre-phase4.bak file we deleted). Two-minute extra step:

1. 1Password → `Web App` → `admin_passcode` → set new value, save.
2. Cycle the web-prod agent so it picks up the new value:
   ```
   launchctl unload ~/Library/LaunchAgents/bet.schnapp.web-prod.plist
   launchctl load   ~/Library/LaunchAgents/bet.schnapp.web-prod.plist
   ```
