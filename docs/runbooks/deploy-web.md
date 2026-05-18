# Runbook: Deploy the Web Tier

The web tier is one launchd agent (`bet.schnapp.web-prod` on `:3001`) serving the `web/.next/` build directory under `/Users/schnapp/code/schnapp-bet/web/`. It targets the local SQL Server container. Dev mode (`next dev` on `:3000`) is not auto-managed — run it interactively via `op run --env-file=../.env.template -- npm run dev` from `web/` when needed.

Manual deploy is triggered via the `deploy-web.yml` GitHub Actions workflow (workflow_dispatch on mac-runner). There is no CI deploy on push to `main`.

## Standard deploy

1. Trigger the workflow:
   - Via `/deploy` slash command (preferred — handles polling and verification).
   - Or via the Schnapp Mac MCP `workflow_trigger` tool with workflow `deploy-web.yml` on branch `main`.
   - Or via `gh workflow run deploy-web.yml`.
2. Workflow clones from GitHub on `mac-runner-1`, runs `npm ci && npm run build`, restarts `bet.schnapp.web-prod` via `launchctl kickstart -k gui/$UID/bet.schnapp.web-prod`, and smoke-tests `http://127.0.0.1:3001`.
3. Verify externally: `curl -s https://schnapp.bet/api/health` should return 200.

## Rollback

The deploy is in-place; the prior `web/.next/` is overwritten. To roll back:

1. Identify the prior working commit: `gh run list --workflow deploy-web.yml --limit 5` and read the commit SHA from the last `success` row.
2. `git -C /Users/schnapp/code/schnapp-bet checkout <prior-sha> -- web/` (or do a full repo checkout if non-web files also need to revert).
3. Trigger `deploy-web.yml` again. The workflow will rebuild from the rolled-back source.
4. After verification, decide whether to `git checkout main -- web/` to restore the rolled-forward state or to leave the rollback as the working tree until a fix lands.

## Failure modes

- **Build fails on mac-runner**: read the run log via `gh run view <run-id> --log` or the Mac MCP `workflow_status` tool. Most common cause: TypeScript error introduced post-test. Run `cd web && npx --no-install tsc --noEmit -p .` locally and fix.
- **Smoke-test fails (web returns 503 after restart)**: check `web/web-prod.log` and `web/web-prod.err.log` via Mac MCP `read_file`. SQL container may be down (`docker ps | grep mssql`; if absent, `docker start mssql` — Colima must be running first via `colima start`).
- **launchctl agent not respawning**: `launchctl list bet.schnapp.web-prod` to confirm `KeepAlive` is honored. If the agent is stuck, `launchctl bootout user/$(id -u) bet.schnapp.web-prod && launchctl bootstrap user/$(id -u) ~/Library/LaunchAgents/bet.schnapp.web-prod.plist`.

## Plist-level changes

Editing `~/Library/LaunchAgents/bet.schnapp.web-prod.plist` (env vars, paths) requires bootout/bootstrap, not kickstart. `launchctl kickstart -k` does not re-read the plist. The canonical copy lives in the repo at `services/launchd/bet.schnapp.web-prod.plist` — edit there, `cp` to `~/Library/LaunchAgents/`, then bootout/bootstrap.
