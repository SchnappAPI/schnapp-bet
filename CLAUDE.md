# CLAUDE.md

Schnapp (schnapp.bet) — personal sports analytics platform for NBA, MLB, and NFL prop
betting research. Moving toward paid subscription.

**Web:** Next.js 15, TypeScript, Tailwind CSS, launchd on Schnapps-MBP (port 3001).
**Database:** SQL Server 2022 in Docker on Schnapps-MBP (localhost,1433).
**ETL/Grading:** Python 3.12, GitHub Actions, mac-runner-1 (self-hosted, Schnapps-MBP).
**Flask:** services/flask/runner.py, launchd on Schnapps-MBP (port 5000), live NBA CDN data.
**MCP:** FastMCP, launchd on Schnapps-MBP (port 8765), mac-mcp.schnapp.bet, 10 tools.
**Shared:** shared/db.py and shared/integrity.py, imported by etl/ and grading/.

Read `docs/README.md` for the full documentation router.
Read `docs/CONNECTIONS.md` for credentials, endpoints, and service details.

## Session Lifecycle

**Starting**: Read MEMORY.md, then LEARNED.md. MEMORY.md is current project state.
LEARNED.md is the correction logbook — every entry is a mistake made before. Read all of it.
If anything in memory, a primer, or chat contradicts the repo, the repo wins. Flag it before
proceeding.
**Ending**: Update MEMORY.md in place. Append one CHANGELOG entry tagged [sport][component].
str_replace any README section that changed. Add an ADR for any non-obvious decision.
If Austin corrected a mistake mid-session, append an entry to LEARNED.md immediately —
do not wait until end of session.
**Context**: Check `/context` periodically. At ~50% usage, stop and update MEMORY.md with
current state. Recommend a new session if the task is long.

## How I Work

- Direct. No fluff. No preambles. No em dashes.
- Lead with recommendations, not option lists.
- Code is production-ready, not a starting point.
- Guided mode: one step at a time, wait for response.
- Autonomous mode: drive to completion without interruption.
- When stuck: state the assumption and proceed. Ask only when the decision is irreversible.
- Do not fix things noticed along the way unless blocking the task. Log to MEMORY.md.
- After any correction: add the pattern to MEMORY.md under Lessons immediately.

## Non-Negotiables

These apply everywhere, every session, no exceptions.

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
  create_or_update_file for those. push_files is safe only for strict-ASCII TS/JSON/YAML.
- Fetch a fresh SHA via get_file immediately before any create_or_update_file on an
  existing file. Stale SHAs cause 409 conflicts.
- fast_executemany=False on grading engine connections only (prevents NVARCHAR(MAX)
  truncation). ETL connections use the default (True).

## References

- Workflow orchestration and task management: `/skill workflow`
- Deploy web app: `/deploy`
- Run grading: `/grade`
- Run ETL: `/etl`
- Check stack status: `/status`
- ETL rules: `.claude/rules/etl.md` (auto-loads on etl/ files)
- Grading rules: `.claude/rules/grading.md` (auto-loads on grading/ files)
- Web rules: `.claude/rules/web.md` (auto-loads on web/ files)
- Shared rules: `.claude/rules/shared.md` (auto-loads on shared/ files)
- Component details: `etl/CLAUDE.md`, `grading/CLAUDE.md`, `web/CLAUDE.md`,
  `shared/CLAUDE.md`, `services/flask/CLAUDE.md`, `database/CLAUDE.md`
