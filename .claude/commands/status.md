---
name: status
description: Show current state of the Schnapp stack — workflows, services, and Mac.
disable-model-invocation: true
---

Run all of the following in parallel and report results in a single summary:

1. `mac_info` — uptime, disk, Docker state.
2. `tunnel_status` — cloudflared state and reachability of all subdomains.
3. `flask_status` — launchd agent state and /ping response.
4. `list_workflow_runs` for each active workflow: `nba-game-day.yml`, `grading.yml`,
   `mlb-grading.yml`, `deploy-web.yml`. Show last run status and completed_at for each.

Report format — four sections, each one line:
- Mac: [uptime] [disk free] [Docker: running/stopped]
- Tunnel: [each subdomain: reachable/unreachable]
- Flask: [running/stopped] [/ping: ok/fail]
- Workflows: [workflow: status (age)] for each
