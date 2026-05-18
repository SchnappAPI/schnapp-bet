---
name: live-session-cache
description: Project override for the user-level live-session-cache skill. Captures each session turn to a chat/* branch so context survives compaction or accidental session loss. Default mode is `always` in Claude Code, `trigger` in claude.ai.
---

# Live Session Cache — schnapp-bet project override

This file overrides defaults from the user-installed skill at `~/.claude/skills/live-session-cache/SKILL.md`. The generic implementation is documented there; only project-specific deviations live here.

## Mode

- Claude Code (on Schnapps-MBP): `always` — chat branch is created at session start.
- claude.ai chat: `trigger` — activates on first non-chats write to avoid overhead on throwaway sessions.

To change globally for this project, edit MEMORY.md with a `live-session-cache: <mode>` line. Valid modes: `trigger`, `always`, `manual`.

## Branch and file convention

- Branch name: `chat/YYYY-MM-DD-{slug}` off `main`.
- File location while active: `chats/in-progress/{slug}.md`.
- File location after wrap-and-merge: `chats/archive/{YYYY}/{MM}/{slug}.md`.

The chat branch is always separate from the work branch. Repo edits proceed on `main` (typical for this project) or whatever branch the work would normally use. The chat log is purely context.

## Integration with the session lifecycle

The chat log does NOT replace end-of-session updates from root `CLAUDE.md`. All required updates still apply:

- One entry at the top of `docs/changelog/2026.md` tagged `[scope][component]`.
- str_replace any README section that changed.
- ADR in `docs/decisions/ADR-YYYYMMDD-N-slug.md` if a non-obvious decision was made.
- MEMORY.md updated with current state.
- LEARNED.md appended if a correction was made mid-session.

The chat log supplements these by capturing the discussion. The CHANGELOG entry summarizes; the chat log preserves the conversation that produced the summary. Each turn's State Delta references the relevant work-branch commit hashes.

## PR convention

Wrap-and-merge opens a PR from the chat branch to `main`. PR title: `chat: {slug}`. PR body: the final summary block from the file. Squash-merge recommended so `main` history shows one commit per chat instead of N turn-level commits.

## What does NOT go in the chat log

- Credentials, API keys, secrets. Redact at write time.
- Long file contents pasted by the user. Tool output (web fetch, file reads) is fine; pasted file dumps are not.
- Code that was never accepted by the user. Only what landed on the work branch gets logged via State Delta and commit hash references.

## Per-turn entry format

```
## Turn N — YYYY-MM-DD HH:MM

### User
{verbatim user message}

### Reasoning
{2 to 5 sentence summary of approach taken}

### Response
{verbatim assistant response}

### Evolution note
{when this turn caused a reframing: how the shift happened, even if no code changed. Omit when not applicable.}

### State delta
{decisions made, files touched on the work branch with commit hashes, errors hit, open questions. Write "No state change" rather than omitting the section.}
```

Commit message format on the chat branch: `chat: turn N — {short description}`.
