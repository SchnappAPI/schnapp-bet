---
name: deploy
description: Trigger deploy-web.yml to build and restart the web app on Schnapps-MBP.
  Confirms the run completed and smoke-tests port 3001.
---

Trigger the deploy-web workflow:

1. Use the Schnapp Mac MCP `workflow_trigger` tool with workflow `deploy-web.yml` on branch `main`.
2. Wait for the run to complete by polling `list_workflow_runs` for `deploy-web.yml` until status is `completed`.
3. Check the conclusion. If `failure`, fetch and show the last 50 lines of the run log.
4. If `success`, verify by running `curl -s http://localhost:3001/api/health || curl -s https://schnapp.bet/api/health` via `shell_exec` and report the response.
5. Report: run ID, duration, and health check result.
