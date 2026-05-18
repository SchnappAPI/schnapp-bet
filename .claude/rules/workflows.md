---
paths:
  - ".github/workflows/**"
---

- `runs-on: [self-hosted, mac-runner]` for any workflow that touches the local SQL container or imports from `shared/`. `ubuntu-latest` only for pure-CI workflows that need no DB or Python.
- Env block must include `PYTHONPATH=/Users/schnapp/code/schnapp-bet` for any workflow that imports from `shared/`. Without it, `from shared.db import get_engine` fails.
- Secrets come from 1Password via `1password/load-secrets-action@v2`, never from GitHub repo secrets directly (per ADR-20260517-5). The only repo-level GitHub secret is `OP_SERVICE_ACCOUNT_TOKEN`. Each workflow declares the `op://` URIs it needs in the action's `env:` block; the canonical env-var → URI mapping is `.env.template` at repo root.
- Required env vars per workflow type: `SQL_SERVER/DATABASE/USERNAME/PASSWORD/TRUST_CERT` for DB-touching workflows. `ODDS_API_KEY` for odds. `NBA_PROXY_URL` for `stats.nba.com`. `RUNNER_API_KEY` for Flask-talking workflows.
- Workflow status: never `gh workflow_status` — it returns stale data. Use `gh run list` / `mcp__github__list_workflow_runs`.
- Any workflow writing data the UI displays must call `record_workflow_run("workflow-name")` as the LAST step. The web tier reads `common.workflow_runs` for freshness indicators.
- One-shot migrations (`grades-migrate`, `mlb-migrate`, etc.) belong only as long as they have a purpose. Delete after they ship.
- `manual` `workflow_dispatch` is the default trigger for any cost-bearing or destructive run. Add a schedule only when the cadence is well understood and idempotent.
- Python runs on mac-runner only.
- Workflows that commit and push must set `git config --local core.hooksPath .githooks` before the first git operation, so the auto-push post-commit hook fires the same way it does in Claude Code sessions. Without it, commits land locally on the runner and never reach origin.
