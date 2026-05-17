# CLAUDE.md

Schnapp (schnapp.bet) — NBA, MLB, NFL prop betting research platform.

**Web:** Next.js 15, TypeScript, Tailwind CSS, launchd on Schnapps-MBP (port 3001).
**Database:** SQL Server 2022 in Docker on Schnapps-MBP (localhost,1433).
**ETL/Grading:** Python 3.12, GitHub Actions, mac-runner-1 (self-hosted, Schnapps-MBP).
**Flask:** services/flask/runner.py, launchd on Schnapps-MBP (port 5000), live NBA CDN data.
**MCP:** FastMCP, launchd on Schnapps-MBP (port 8765), mac-mcp.schnapp.bet, 10 tools.
**Shared:** shared/db.py and shared/integrity.py, imported by etl/ and grading/.

## Session Lifecycle

**Starting**: Read MEMORY.md, then LEARNED.md. If anything in memory, a primer, or
chat contradicts the repo, the repo wins. Flag it before proceeding.
**Ending**: Update MEMORY.md with current state. Append one CHANGELOG entry tagged
[sport][component]. str_replace any README section that changed. Add an ADR for any
non-obvious decision. If corrected mid-session, append to LEARNED.md immediately.
**Context**: At ~50% usage, stop and update MEMORY.md. Recommend a new session if
the task is long.
**Compaction**: After /compact, re-read MEMORY.md and LEARNED.md — they are not
automatically re-injected.

## Non-Negotiables

- Python runs in GitHub Actions on mac-runner or via Mac MCP shell_exec only.
- Never commit without a CHANGELOG entry.
- One commit per file. Never bundle multiple file changes into a single commit.
- Never hardcode credentials, hostnames, or IPs.
- Never run DROP TABLE, git reset --hard, or rm -rf without explicit confirmation.
- Every new workflow importing from shared/ must set
  PYTHONPATH=/Users/schnapp/schnapp-bet in its env block.
- Every workflow writing data the UI displays must call record_workflow_run() last.
- Live workflow status: use list_workflow_runs. workflow_status returns stale data.
- Never use push_files for .py files or TSX with non-ASCII Unicode. Use
  create_or_update_file. push_files is safe only for strict-ASCII TS/JSON/YAML.
- Fetch a fresh SHA via get_file immediately before any create_or_update_file on an
  existing file. Stale SHAs cause 409 conflicts.
- fast_executemany=False on grading engine connections only. ETL uses the default (True).

## Commands and Skills

- `/deploy` — trigger deploy-web.yml
- `/grade` — trigger grading workflow
- `/etl` — trigger ETL workflow
- `/status` — stack health check
- `/skill workflow` — planning and task management

## Rules (auto-load on matching files)

- ETL: `.claude/rules/etl.md`
- Grading: `.claude/rules/grading.md`
- Web: `.claude/rules/web.md`
- Shared: `.claude/rules/shared.md`
