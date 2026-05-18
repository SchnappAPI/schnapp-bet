# Cutover Checklist — schnapp-bet first run

The schnapp-bet repo is fully ported but nothing actually runs until these manual actions are completed. Run them roughly in order — each step's verification step gates the next.

Assumes you are on Schnapps-MBP with `op` CLI v2.34+ at `/usr/local/bin/op` and `gh` CLI installed, and that `OP_SERVICE_ACCOUNT_TOKEN` is already exported in `~/.zshrc`.

---

## 1. Set the GitHub repo secret

**Goal:** Make `OP_SERVICE_ACCOUNT_TOKEN` available to all 27 workflows. Without it, the "Load secrets from 1Password" step fails in every run.

```bash
cd ~/code/schnapp-bet

# Push ~/.zshrc's token to GitHub Actions secrets:
grep '^export OP_SERVICE_ACCOUNT_TOKEN=' ~/.zshrc \
  | cut -d= -f2- \
  | gh secret set OP_SERVICE_ACCOUNT_TOKEN --repo SchnappAPI/schnapp-bet
```

**Verify:**

```bash
gh secret list --repo SchnappAPI/schnapp-bet
# Expected: OP_SERVICE_ACCOUNT_TOKEN  Updated YYYY-MM-DD
```

**Rollback:** `gh secret delete OP_SERVICE_ACCOUNT_TOKEN --repo SchnappAPI/schnapp-bet`.

---

## 2. Re-register the self-hosted mac-runner

**Goal:** The runner currently points at `SchnappAPI/sports-modeling` (launchd label `actions.runner.SchnappAPI-sports-modeling.mac-runner-1`). Workflows in schnapp-bet won't pick it up until it's registered against the new repo.

**Pick a path:**

- **Path A — parallel runners** (both repos stay live, easier to retreat from)
- **Path B — migrate** (one runner, point it at schnapp-bet only)

### Path A: install a second runner

```bash
# 1. Get a registration token for schnapp-bet (good for ~1 hour):
TOKEN=$(gh api -X POST repos/SchnappAPI/schnapp-bet/actions/runners/registration-token --jq .token)

# 2. Find the actions-runner version your existing runner uses (so this matches):
EXISTING_DIR=$(launchctl print "gui/$(id -u)/actions.runner.SchnappAPI-sports-modeling.mac-runner-1" \
  2>/dev/null | grep "working directory" | awk -F'= ' '{print $2}')
echo "Existing runner dir: $EXISTING_DIR"
RUNNER_VERSION=$(cat "$EXISTING_DIR/.runner_version" 2>/dev/null || echo 2.319.1)
echo "Version: $RUNNER_VERSION"

# 3. Set up a new runner in its own dir:
mkdir -p ~/actions-runner-schnapp-bet && cd ~/actions-runner-schnapp-bet
ARCH=$(uname -m | sed 's/x86_64/x64/;s/arm64/arm64/')
curl -sLO "https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/actions-runner-osx-${ARCH}-${RUNNER_VERSION}.tar.gz"
tar xzf "actions-runner-osx-${ARCH}-${RUNNER_VERSION}.tar.gz"

# 4. Configure:
./config.sh \
  --url https://github.com/SchnappAPI/schnapp-bet \
  --token "$TOKEN" \
  --name mac-runner-1 \
  --labels self-hosted,mac-runner \
  --work _work \
  --unattended

# 5. Install + start as launchd service:
./svc.sh install
./svc.sh start
```

### Path B: migrate the existing runner

```bash
# 1. Locate the existing runner directory (the .runner file is the marker):
EXISTING_DIR=$(launchctl print "gui/$(id -u)/actions.runner.SchnappAPI-sports-modeling.mac-runner-1" \
  2>/dev/null | grep "working directory" | awk -F'= ' '{print $2}')
echo "Existing runner dir: $EXISTING_DIR"
cd "$EXISTING_DIR"

# 2. Stop and uninstall the service:
./svc.sh stop
./svc.sh uninstall

# 3. Get a removal token for the OLD repo and unregister:
REMOVE_TOKEN=$(gh api -X POST repos/SchnappAPI/sports-modeling/actions/runners/remove-token --jq .token)
./config.sh remove --token "$REMOVE_TOKEN"

# 4. Get a registration token for the NEW repo and re-configure:
REG_TOKEN=$(gh api -X POST repos/SchnappAPI/schnapp-bet/actions/runners/registration-token --jq .token)
./config.sh \
  --url https://github.com/SchnappAPI/schnapp-bet \
  --token "$REG_TOKEN" \
  --name mac-runner-1 \
  --labels self-hosted,mac-runner \
  --work _work \
  --unattended

# 5. Reinstall service:
./svc.sh install
./svc.sh start
```

**Verify (either path):**

```bash
launchctl list | grep actions.runner

# GitHub side:
gh api repos/SchnappAPI/schnapp-bet/actions/runners --jq '.runners[] | {name, status, busy, labels: [.labels[].name]}'
# Expected: at least one runner with status "online" and labels including "self-hosted" + "mac-runner".
```

**Rollback Path B (re-register at sports-modeling):**

```bash
cd "$EXISTING_DIR"
./svc.sh stop && ./svc.sh uninstall
REMOVE_TOKEN=$(gh api -X POST repos/SchnappAPI/schnapp-bet/actions/runners/remove-token --jq .token)
./config.sh remove --token "$REMOVE_TOKEN"
REG_TOKEN=$(gh api -X POST repos/SchnappAPI/sports-modeling/actions/runners/registration-token --jq .token)
./config.sh --url https://github.com/SchnappAPI/sports-modeling --token "$REG_TOKEN" --name mac-runner-1 --labels self-hosted,mac-runner --work _work --unattended
./svc.sh install && ./svc.sh start
```

---

## 3. Install the new launchd plists

**Goal:** Replace `~/Library/LaunchAgents/bet.schnapp.{flask,web-prod}.plist` (which point at `/Users/schnapp/sports-modeling/` and carry plaintext secrets) with the new versions that wrap `op run` via `services/launchd/op-wrap.sh`.

**Warning:** This stops the running Flask and web services briefly. If web is serving live traffic, do this during a quiet window.

```bash
cd ~/code/schnapp-bet

# 1. Stop the old agents:
launchctl unload ~/Library/LaunchAgents/bet.schnapp.flask.plist 2>/dev/null
launchctl unload ~/Library/LaunchAgents/bet.schnapp.web-prod.plist 2>/dev/null

# 2. Back up originals so the secrets aren't lost if anything else references them:
cp ~/Library/LaunchAgents/bet.schnapp.flask.plist \
   ~/Library/LaunchAgents/bet.schnapp.flask.plist.pre-1password
cp ~/Library/LaunchAgents/bet.schnapp.web-prod.plist \
   ~/Library/LaunchAgents/bet.schnapp.web-prod.plist.pre-1password

# 3. Install new versions:
cp services/launchd/bet.schnapp.flask.plist    ~/Library/LaunchAgents/
cp services/launchd/bet.schnapp.web-prod.plist ~/Library/LaunchAgents/

# 4. Load:
launchctl load ~/Library/LaunchAgents/bet.schnapp.flask.plist
launchctl load ~/Library/LaunchAgents/bet.schnapp.web-prod.plist
```

**Verify:**

```bash
# Both agents loaded, PID > 0 means running:
launchctl list | grep bet.schnapp

# Flask reachable:
curl -sf http://127.0.0.1:5000/health && echo " — flask OK" \
  || tail -50 ~/code/schnapp-bet/services/flask/flask.err.log

# Web reachable (only after Action 4 has built the web dir):
curl -sf http://127.0.0.1:3001 -o /dev/null -w 'HTTP %{http_code}\n' \
  || tail -50 ~/code/schnapp-bet/web/web-prod.err.log
```

If web errs with "no Next.js production build found", that's expected — Action 4 builds it.

**Rollback:**

```bash
launchctl unload ~/Library/LaunchAgents/bet.schnapp.flask.plist
launchctl unload ~/Library/LaunchAgents/bet.schnapp.web-prod.plist
mv ~/Library/LaunchAgents/bet.schnapp.flask.plist.pre-1password    ~/Library/LaunchAgents/bet.schnapp.flask.plist
mv ~/Library/LaunchAgents/bet.schnapp.web-prod.plist.pre-1password ~/Library/LaunchAgents/bet.schnapp.web-prod.plist
launchctl load   ~/Library/LaunchAgents/bet.schnapp.flask.plist
launchctl load   ~/Library/LaunchAgents/bet.schnapp.web-prod.plist
```

---

## 4. Build web for prod

**Goal:** Make `next start` in the web-prod plist succeed by producing `web/.next/`.

```bash
cd ~/code/schnapp-bet/web

# Install (note: --no-workspaces; the root package.json declares web as a workspace
# but for this single-package build we go direct):
op run --env-file=../.env.template -- npm ci --no-workspaces

# Build:
op run --env-file=../.env.template -- npm run build --no-workspaces
```

**Verify:**

```bash
ls .next/   # expect: BUILD_ID, server/, static/, ...

# Cycle the web-prod agent to actually pick up the new build:
launchctl unload ~/Library/LaunchAgents/bet.schnapp.web-prod.plist
launchctl load   ~/Library/LaunchAgents/bet.schnapp.web-prod.plist
sleep 3
curl -sf http://127.0.0.1:3001 -o /dev/null -w 'HTTP %{http_code}\n'
# Expected: HTTP 200
```

After the first build lands, future deploys go through `deploy-web.yml` (the staging-clone-then-swap workflow).

**Rollback:** `rm -rf web/.next` and reload the old plist.

---

## 5. SQL Server database name

**Goal:** Decide whether the database is `sports-modeling` or `schnapp-bet`. The data is the same; the name is the only difference.

**Recommendation:** Do NOT rename right now. The name is internal — only 1Password and connection strings reference it. Renaming requires a brief outage and isn't on the critical path. Revisit later if it bothers you.

If you DO want to rename:

```bash
cd ~/code/schnapp-bet

# 1. Stop everything that holds connections:
launchctl unload ~/Library/LaunchAgents/bet.schnapp.flask.plist
launchctl unload ~/Library/LaunchAgents/bet.schnapp.web-prod.plist
# If any workflows are running, cancel them via the GitHub UI first.

# 2. ALTER DATABASE. Find your sqlcmd path first:
SQLCMD=$(command -v sqlcmd || echo "docker exec sql-server /opt/mssql-tools18/bin/sqlcmd")
echo "Using: $SQLCMD"

# 3. Run the rename:
op run --env-file=.env.template -- bash -c "
  $SQLCMD -S localhost,1433 -U sa -P \"\$MSSQL_SA_PASSWORD\" -C -Q \"
    USE master;
    ALTER DATABASE [sports-modeling] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
    ALTER DATABASE [sports-modeling] MODIFY NAME = [schnapp-bet];
    ALTER DATABASE [schnapp-bet] SET MULTI_USER;
  \"
"
```

4. In 1Password (web UI), edit:
   - `Database` item → `database` field → change `sports-modeling` to `schnapp-bet`.
   - `Web App` item → `sql_connection_string` field → change `Database=sports-modeling;` to `Database=schnapp-bet;`.

5. Restart services:
   ```bash
   launchctl load ~/Library/LaunchAgents/bet.schnapp.flask.plist
   launchctl load ~/Library/LaunchAgents/bet.schnapp.web-prod.plist
   ```

**Verify:**

```bash
op run --env-file=.env.template -- bash -c '
  $SQLCMD -S localhost,1433 -U sa -P "$MSSQL_SA_PASSWORD" -C -Q "SELECT name FROM sys.databases;"
'
# Expected: schnapp-bet appears in the list (and sports-modeling does NOT).
```

**Rollback:** Same `ALTER DATABASE ... MODIFY NAME` in reverse, then revert the 1Password fields.

---

## 6. Rotate OP_SERVICE_ACCOUNT_TOKEN

**Goal:** Replace the service account token if you suspect it leaked. Today's events: it transited Claude Code's conversation context (when grepping `~/.zshrc`). If shoulder-surfing or transcript-exfiltration is in your threat model, rotate.

```bash
# 1. Generate a new token via 1Password UI:
#    Web → Settings → Developer → Service Accounts → schnapp-automation → "Rotate token"
#    Copy the new token (starts with `ops_`).

# 2. Replace in ~/.zshrc (let's call the new value $NEW_TOKEN):
NEW_TOKEN='ops_eyJ...'   # paste here, then immediately clear shell history
sed -i.bak "s|^export OP_SERVICE_ACCOUNT_TOKEN=.*|export OP_SERVICE_ACCOUNT_TOKEN=$NEW_TOKEN|" ~/.zshrc
rm ~/.zshrc.bak
unset NEW_TOKEN
source ~/.zshrc

# 3. Update the GitHub Actions secret:
grep '^export OP_SERVICE_ACCOUNT_TOKEN=' ~/.zshrc | cut -d= -f2- \
  | gh secret set OP_SERVICE_ACCOUNT_TOKEN --repo SchnappAPI/schnapp-bet

# 4. Cycle launchd agents so op-wrap.sh picks up the new token:
launchctl unload ~/Library/LaunchAgents/bet.schnapp.flask.plist
launchctl unload ~/Library/LaunchAgents/bet.schnapp.web-prod.plist
launchctl load   ~/Library/LaunchAgents/bet.schnapp.flask.plist
launchctl load   ~/Library/LaunchAgents/bet.schnapp.web-prod.plist

# 5. Clear shell history (because $NEW_TOKEN was in your terminal):
history -c
```

**Verify:**

```bash
# Local: should succeed (proves new token works).
op vault list

# GitHub: re-run a small workflow to verify the GH secret rotation.
gh workflow run claude.yml --repo SchnappAPI/schnapp-bet 2>/dev/null \
  || echo "claude.yml only runs on @claude mentions — pick a workflow_dispatch one instead"
gh workflow run daily-health-report.yml --repo SchnappAPI/schnapp-bet
gh run watch --repo SchnappAPI/schnapp-bet $(gh run list --repo SchnappAPI/schnapp-bet --workflow daily-health-report.yml --limit 1 --json databaseId --jq '.[0].databaseId')
```

---

## End-to-end smoke

After Actions 1–4 land:

```bash
# Trigger the canonical workflow:
gh workflow run nba-etl.yml --repo SchnappAPI/schnapp-bet -f days=1

# Watch it:
sleep 5
RUN_ID=$(gh run list --repo SchnappAPI/schnapp-bet --workflow nba-etl.yml --limit 1 --json databaseId --jq '.[0].databaseId')
gh run watch --repo SchnappAPI/schnapp-bet "$RUN_ID"
```

The pipeline you care about:

1. **Job picked up by mac-runner-1** — runner re-registration worked (Action 2).
2. **"Load secrets from 1Password" step succeeds** — GitHub secret is set (Action 1), 1Password vault is reachable.
3. **"Run NBA ETL" step connects to SQL Server** — database name matches what's in the vault (Action 5 either-way).
4. **Flask is up** — `curl http://127.0.0.1:5000/health` (Action 3).
5. **Web is up** — `curl http://127.0.0.1:3001` (Actions 3 + 4).

If step N fails, fix that and re-run. Don't combine steps.
