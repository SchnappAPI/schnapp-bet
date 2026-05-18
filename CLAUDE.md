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
- **Ending — scale ceremony by task size (per ADR-20260517-3, refined by ADR-20260517-4):**
  - **Trivial** (typo, comment, single-line fix) — commit with a properly formatted subject.
  - **Routine** (port, feature, refactor) — commit + MEMORY.md state update.
  - **Milestone** (non-obvious decision, new convention, architectural shift) — commit + MEMORY.md + ADR in `docs/decisions/ADR-YYYYMMDD-N-slug.md`. The ADR's first application is referenced in the commit subject as `— ADR-YYYYMMDD-N`.
  - **Mid-session correction** — append to LEARNED.md immediately, regardless of task size.
  - **Documentation drift** — `str_replace` the affected README section in the same commit as the code change.
- **Context** — At ~50% usage, update MEMORY.md and recommend a new session if the task is long.
- **Compaction** — After `/compact`, re-read MEMORY.md and LEARNED.md. They are not automatically re-injected.

## Where to run this work

Claude Code on the Mac is the primary surface. Direct local edits, multi-file commits, and inline build checks are free here.

Claude.ai chat is the fallback when the Mac is unreachable. Every file edit there is a full-file upload via GitHub MCP — acceptable for one-off doc edits, not for code or multi-file changes. End such a session with a paste-ready Claude Code prompt.

## Commit subject format

The commit subject **is** the changelog entry. Format is mandatory (per ADR-20260517-4):

```
<type>: [scope1][scope2] short description — ADR-YYYYMMDD-N
```

- `<type>` ∈ `feat`, `fix`, `refactor`, `docs`, `chore`, `perf`, `test`, `style`, `revert`.
- `[scope]` brackets carry tag taxonomy: `[nba]`, `[mlb]`, `[nfl]`, `[shared]`, `[etl]`, `[grading]`, `[web]`, `[database]`, `[odds]`, `[services]`, `[infra]`, `[docs]`, `[meta]`, `[all]`. Multiple tags allowed and encouraged for cross-cutting changes.
- The ADR reference (`— ADR-YYYYMMDD-N`) is optional, used only when the change corresponds to a recorded decision.
- Aim for under ~100 chars. Use the body for extended detail when the subject would otherwise sprawl.

Filtering with plain git:

| Need          | Command                                         |
| ------------- | ----------------------------------------------- |
| All changes   | `git log --oneline`                             |
| By tag        | `git log --grep='\[nba\]'`                      |
| By type       | `git log --grep='^feat:'`                       |
| By date       | `git log --since=2026-01-01`                    |
| Rendered file | `git log --pretty='format:- %s' > CHANGELOG.md` |

Pre-policy commits use single-scope `type(scope):` style. To cover both eras: `git log --grep='\[meta\]\|(meta)'`.

## Non-Negotiables

Cross-cutting rules only. Path-specific invariants live in `.claude/rules/*.md` and auto-load when editing matching files.

### Repo & host

- Python runs in GitHub Actions on mac-runner or via Mac MCP `shell_exec` only.
- Never hardcode credentials, hostnames, or IPs.

### Secrets

- **1Password vault `web-variables` is the single source of truth** for runtime secrets (per ADR-20260517-5). The mapping of env var → `op://` URI lives in `.env.template` at repo root.
- **Bootstrap secret**: `OP_SERVICE_ACCOUNT_TOKEN`. On Schnapps-MBP it is in `~/.zshrc`. On GitHub Actions it is the _only_ repository secret.
- **Local dev**: invoke commands via `op run --env-file=.env.template -- <command>`. Never resolve URIs to a plaintext file on disk.
- **GitHub Actions**: use `1password/load-secrets-action@v2`. Each workflow declares the URIs it needs in the action's `env:` block.
- **Adding a new env var** is a coupled three-part change: vault item/field, `.env.template` line, and the code that reads `os.environ[...]`. A PR with only the code side is incomplete.

### Commits & history

- **One logical change per commit** — not one file. A logical change is the smallest self-consistent unit; coupled files are committed together. (Per ADR-20260517-3.)
- **The commit subject is the changelog entry.** The format above is mandatory and enforced by `.githooks/commit-msg`. Malformed subjects are rejected before the commit lands. (Per ADR-20260517-4.)
- Every commit pushes to `origin` immediately via the `.githooks/post-commit` hook. The SessionStart bootstrap activates `core.hooksPath` on every Claude Code session. Never bypass with `--no-verify`.
- Never run `DROP TABLE`, `git reset --hard`, or `rm -rf` without explicit confirmation.

### GitHub MCP

- Never use `push_files` for `.py` files or `.tsx` with non-ASCII Unicode. Use `create_or_update_file`. `push_files` is safe only for strict-ASCII TS/JSON/YAML.
- Fetch a fresh SHA via `get_file` immediately before any `create_or_update_file` on an existing file. Stale SHAs cause 409 conflicts.

### Workflow status

- Live workflow status: use `list_workflow_runs`. `workflow_status` returns stale data.

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
