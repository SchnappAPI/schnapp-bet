# CLAUDE.md

Schnapp (schnapp.bet) — NBA, MLB, NFL prop betting research platform.

## Stack

- **Web** — Next.js 15, TypeScript, Tailwind. launchd on Schnapps-MBP (port 3001).
- **Database** — SQL Server 2022 in Docker on Schnapps-MBP (`localhost,1433`).
- **ETL / Grading** — Python 3.12, GitHub Actions, `mac-runner-1` (self-hosted, Schnapps-MBP).
- **Flask** — `services/flask/runner.py`. launchd on Schnapps-MBP (port 5000). Live NBA CDN proxy.
- **MCP** — FastMCP. launchd on Schnapps-MBP (port 8765). `mac-mcp.schnapp.bet`. 10 tools.
- **Shared** — `shared/db.py` and `shared/integrity.py`, imported by `etl/` and `grading/`.

Repo path: `/Users/schnapp/code/schnapp-bet`. Primary host: Schnapps-MBP. Python runs in GitHub Actions on mac-runner or via Mac MCP `shell_exec` only.

## Session Lifecycle

- **Starting** — Read MEMORY.md, then LEARNED.md. If memory contradicts the repo, the repo wins. Flag it before proceeding.
- **Ending** — Update MEMORY.md with current state. Append a CHANGELOG entry tagged `[sport][component]` in `docs/changelog/2026.md`. `str_replace` any README section that changed. Add an ADR in `docs/decisions/ADR-YYYYMMDD-N-slug.md` for any non-obvious decision. Append to LEARNED.md immediately if corrected mid-session.
- **Context** — At ~50% usage, update MEMORY.md and recommend a new session if the task is long.
- **Compaction** — After `/compact`, re-read MEMORY.md and LEARNED.md. They are not automatically re-injected.

## Where to run this work

Claude Code on the Mac is the primary surface. Direct local edits, multi-file commits, and inline build checks are free here.

Claude.ai chat is the fallback when the Mac is unreachable. Every file edit there is a full-file upload via GitHub MCP — acceptable for one-off doc edits, not for code or multi-file changes. End such a session with a paste-ready Claude Code prompt.

## Non-Negotiables

### Repo & host

- Python runs in GitHub Actions on mac-runner or via Mac MCP `shell_exec` only.
- Never hardcode credentials, hostnames, or IPs.
- Workflows importing from `shared/` must set `PYTHONPATH=/Users/schnapp/code/schnapp-bet` in their env block.

### Commits & history

- One commit per file. Never bundle multiple file changes into a single commit.
- Never commit without a CHANGELOG entry in `docs/changelog/YYYY.md`.
- Every commit pushes to `origin` immediately via the `.githooks/post-commit` hook. The SessionStart bootstrap activates the hookspath on every Claude Code session. Never bypass with `--no-verify`.
- Never run `DROP TABLE`, `git reset --hard`, or `rm -rf` without explicit confirmation.

### GitHub MCP

- Never use `push_files` for `.py` files or `.tsx` with non-ASCII Unicode. Use `create_or_update_file`. `push_files` is safe only for strict-ASCII TS/JSON/YAML.
- Fetch a fresh SHA via `get_file` immediately before any `create_or_update_file` on an existing file. Stale SHAs cause 409 conflicts.

### Workflows

- Every workflow writing data the UI displays must call `record_workflow_run()` last.
- Live workflow status: use `list_workflow_runs`. `workflow_status` returns stale data.

### Database engine

- `fast_executemany=False` on grading engine connections only. ETL uses the default (True).

## Commands

- `/deploy` — trigger `deploy-web.yml`.
- `/grade` — trigger grading workflow.
- `/etl` — trigger ETL workflow.
- `/status` — stack health check.
- `/adr` — create today's ADR with the next counter.

## Skills

- `/skill workflow` — planning and task management.
- `/skill regenerate-bootstrap-sql` — re-sync schema docs from the live DB.
- `/skill regenerate-health` — re-run the health report locally.
- `/skill new-sport-onboarding` — add a 4th sport checklist.
- `/skill changelog-rotate` — year-rotate `docs/changelog/`.

## Rules (auto-load on matching files)

- ETL — `.claude/rules/etl.md`
- Grading — `.claude/rules/grading.md`
- Web — `.claude/rules/web.md`
- Shared — `.claude/rules/shared.md`
- Database — `.claude/rules/database.md`
- Flask — `.claude/rules/flask.md`
- Workflows — `.claude/rules/workflows.md`
- Docs — `.claude/rules/docs.md`

## References

See `docs/README.md` for the documentation router.
