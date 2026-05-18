# Cutover Follow-ups — schnapp-bet

Full first-run cutover landed 2026-05-18. End-to-end smoke verified (`nba-etl.yml` ran on `mac-runner-1`, 1Password resolved every secret, SQL Server received writes). The original four-step cutover (GitHub secret, runner re-registration, launchd plist install, web prod build) is **done**.

This file now lists ONLY what is optional and outstanding. None of these block the platform — it's been running since cutover. For the completed actions, see git history: `git log --grep='ADR-20260517-5'`.

---

## 1. Retire the stale `bet.schnapp.web` dev agent

**State:** still loaded at cutover time. The plist at `~/Library/LaunchAgents/bet.schnapp.web.plist` points at `/Users/schnapp/sports-modeling/web/` and runs `next dev` against the OLD repo.

**Recommendation:** unload it. Dev mode against the new repo is a one-liner whenever you need it (`cd ~/code/schnapp-bet/web && op run --env-file=../.env.template -- npm run dev`); a permanent dev agent against the old repo is dead weight.

```
launchctl unload ~/Library/LaunchAgents/bet.schnapp.web.plist
rm ~/Library/LaunchAgents/bet.schnapp.web.plist
```

Verify:

```
launchctl list | grep bet.schnapp
```

Expected: only `bet.schnapp.flask` and `bet.schnapp.web-prod` (no `bet.schnapp.web`).

---

## 2. Delete the pre-1Password plist backups

Now that the new plists are stable, remove the `.pre-1password` copies — they contained plaintext secrets and shrink the disk-resident secret surface to zero (except `~/.zshrc`).

```
rm ~/Library/LaunchAgents/bet.schnapp.flask.plist.pre-1password
rm ~/Library/LaunchAgents/bet.schnapp.web-prod.plist.pre-1password
```

Verify:

```
ls ~/Library/LaunchAgents/bet.schnapp*
```

Expected: only `bet.schnapp.flask.plist` and `bet.schnapp.web-prod.plist`.

---

## 3. SQL Server database name (cosmetic only)

The 1Password `Database` item's `database` field still says `sports-modeling`. The database inside the live SQL Server container has the same name. It's internal — never visible to end users.

**Recommendation:** skip. The mismatch between the project name and the DB name is purely aesthetic.

If you DO want to rename:

```
cd ~/code/schnapp-bet

# 1. Stop everything that holds DB connections:
launchctl unload ~/Library/LaunchAgents/bet.schnapp.flask.plist
launchctl unload ~/Library/LaunchAgents/bet.schnapp.web-prod.plist
# Cancel any in-flight workflows via the GitHub UI first.

# 2. Rename. Use whichever of these matches your environment.
#
# If `sqlcmd` is in your PATH (typical on Schnapps-MBP):
op run --env-file=.env.template -- bash -c '
  sqlcmd -S localhost,1433 -U sa -P "$MSSQL_SA_PASSWORD" -C -Q "
    USE master;
    ALTER DATABASE [sports-modeling] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
    ALTER DATABASE [sports-modeling] MODIFY NAME = [schnapp-bet];
    ALTER DATABASE [schnapp-bet] SET MULTI_USER;
  "
'
#
# Or, if sqlcmd is only inside the Docker container (replace `mssql` with `docker ps` name):
# op run --env-file=.env.template -- bash -c '
#   docker exec mssql /opt/mssql-tools18/bin/sqlcmd -S localhost,1433 -U sa -P "$MSSQL_SA_PASSWORD" -C -Q "USE master; ALTER DATABASE [sports-modeling] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; ALTER DATABASE [sports-modeling] MODIFY NAME = [schnapp-bet]; ALTER DATABASE [schnapp-bet] SET MULTI_USER;"
# '
```

3. In 1Password (web UI), edit:
   - `Database` item → `database` field: `sports-modeling` → `schnapp-bet`.
   - `Web App` item → `sql_connection_string` field: `Database=sports-modeling;` → `Database=schnapp-bet;`.

4. Restart services:

```
launchctl load ~/Library/LaunchAgents/bet.schnapp.flask.plist
launchctl load ~/Library/LaunchAgents/bet.schnapp.web-prod.plist
```

Verify:

```
op run --env-file=.env.template -- bash -c 'sqlcmd -S localhost,1433 -U sa -P "$MSSQL_SA_PASSWORD" -C -Q "SELECT name FROM sys.databases;"'
```

Expected: `schnapp-bet` appears, `sports-modeling` does not.

Rollback: same `ALTER DATABASE ... MODIFY NAME` in reverse, then revert the 1Password fields.

---

## 4. Rotate `OP_SERVICE_ACCOUNT_TOKEN` (recommended)

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

Expected: the "Load secrets from 1Password" step succeeds. That's the only signal that confirms the GH-side rotation worked.

The old token is invalidated the moment you rotate in the 1Password UI; any system still using it (e.g. a forgotten cron or a different repo's runner) will start failing — which is the point.
