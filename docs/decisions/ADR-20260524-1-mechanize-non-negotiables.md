# ADR-20260524-1 — Mechanize CLAUDE.md non-negotiables as PreToolUse Bash hook

Date: 2026-05-24
Status: Accepted

## Context

CLAUDE.md lists destructive commands as non-negotiables: "Never run `DROP TABLE`, `git reset --hard`, or `rm -rf` without explicit confirmation. Never bypass with `--no-verify`." These existed as a written rule only — relying on Claude to read CLAUDE.md and self-restrain each session. That works in practice most of the time, but the rule is unenforced in two failure modes:

1. A new Claude Code session that hasn't yet loaded CLAUDE.md (early-turn tool calls).
2. A subagent invoked without inheriting the main thread's read of CLAUDE.md.

The rest of the meta layer already mechanizes its non-negotiables:

- Commit subject format → `.githooks/commit-msg` rejects malformed subjects.
- Auto-push on every commit → `.githooks/post-commit`.
- Protected-file edits → `.claude/hooks/protect-files.sh` PreToolUse on `Edit|Write`.

The "no destructive Bash commands" non-negotiable was the last non-negotiable still living only in prose. This ADR closes that gap.

## Decision

1. **Add `.claude/hooks/destructive-guard.sh`** as a PreToolUse hook on the `Bash` matcher. It reads the tool input JSON, matches the command against an extended-regex list, and exits 2 (block) with a stderr explanation on hit. Patterns covered:
   - `DROP TABLE`, `DROP DATABASE`, `TRUNCATE` (case-insensitive, word-bounded).
   - `git reset --hard`.
   - `git push --force` / `git push -f`.
   - `git branch -D`.
   - `rm -rf` and equivalent flag orderings.
   - `--no-verify` (any context — git, npm, etc.).

2. **Single-use bypass file**: `.claude/.allow-destructive`. When the file exists, the next matching command is allowed through and the file is deleted immediately. The bypass is single-use by design — repeated destructive operations require repeated, deliberate consent. The file is gitignored (covered by `.claude/` patterns in the existing `.gitignore` if applicable; otherwise add explicitly).

3. **Out of scope for the guard** — the hook does not attempt to block:
   - Schema migrations under `database/_shared/` that include `DROP` statements inside migration files (the file is read by SQL Server, not executed via Bash).
   - Container-level destruction (`docker rm`, `docker volume rm`) — those are intentional and frequent in this stack.
   - File deletions via `Write` or `Edit` tools — covered separately by `protect-files.sh`.

4. **Documentation in CLAUDE.md** updates the non-negotiable wording from "Never run X without explicit confirmation" to: "Destructive commands are blocked by `.claude/hooks/destructive-guard.sh`. To proceed, `touch .claude/.allow-destructive` immediately before the command. The bypass is consumed on first match." (Defer this CLAUDE.md edit to the same commit that ships the hook.)

## Consequences

- **Symmetry with the rest of the meta layer.** Every CLAUDE.md non-negotiable now has a mechanical enforcement point: commit-msg, post-commit, protect-files, destructive-guard.
- **Single-use bypass forces deliberation.** Compared to a config-key opt-out, the `touch` step is friction proportional to risk — easy enough for legitimate destructive work, costly enough to discourage habit.
- **Subagent safety.** Subagents inherit the project's `.claude/settings.json` hooks. The guard fires regardless of whether the subagent read CLAUDE.md.
- **False positive surface.** The patterns are word-bounded but will fire on legitimate strings inside commands that happen to contain `TRUNCATE` etc. (e.g., grepping logs for the word). The bypass workflow handles this; the cost is one extra `touch` call when intentionally working with the word as data.
- **The guard does not protect against `--no-verify` inside `.githooks/commit-msg` configuration changes**; only against passing it on the command line. The hooks themselves are protected by `protect-files.sh`'s `.git/` pattern.

## Companion changes shipped in the same commit

- `.claude/hooks/ruff-lint.sh` (PostToolUse on `Edit|Write`) — Python equivalent of the existing prettier+tsc post-edit hook. Uses `uvx ruff` so no local install is required.
- `.claude/skills/adr-writer/SKILL.md` — Claude-invocable companion to the user-only `/adr` slash command. Both produce identical on-disk format; the skill is what gets reached for autonomously during the session-end Milestone ceremony.
- `.claude/agents/etl-integrity-reviewer.md` — domain-specific subagent enforcing ADR-20260424-2 data-integrity invariants on diffs that touch `etl/`, `shared/integrity.py`, `shared/db.py`, or sport workflows.
- `context7` MCP server registered at user level (`~/.claude.json`) — out-of-repo, not part of this commit.

## Out of scope

- Migrating `.githooks/post-commit` auto-push or `.githooks/commit-msg` enforcement into `.claude/hooks/`. Those are git-level concerns and stay in `.githooks/`.
- Adding `--allowedTools` restrictions to subagent definitions. The PreToolUse Bash hook covers the same surface more cleanly.
- Per-pattern severity (e.g., warn vs. block). All current patterns are hard-block; nothing is "warn".
