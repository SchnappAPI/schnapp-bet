# HANDOFF-A — Paste into Claude chat (claude.ai)

**Audience**: a fresh Claude chat session at claude.ai that has GitHub MCP access with permission to create repositories under the `schnappapi` org.

**This file is the prompt.** Copy from the `--- BEGIN PASTE ---` marker to the `--- END PASTE ---` marker. Paste as the first message of the new session.

---

--- BEGIN PASTE ---

You are continuing a multi-session bootstrap to create a new public repo, `schnappapi/schnapp-kit`. The full context lives at `schnappapi/schnapp-bet:.kit-bootstrap/` on branch `claude/awesome-cori-p23yR`. Please use GitHub MCP to read the files you need.

## Your job

Two things only:

1. **Create the new repo** `schnappapi/schnapp-kit` as **public**, with a minimal `README.md` placeholder, default branch `main`. Do not push any other files.
2. **Write `HANDOFF-B-claude-code.md`** into `schnappapi/schnapp-bet:.kit-bootstrap/HANDOFF-B-claude-code.md` (branch `claude/awesome-cori-p23yR`), generated from the template at `schnappapi/schnapp-bet:.kit-bootstrap/HANDOFF-B-template.md`. The only customizations the template needs are:
   - Replace `{{KIT_REPO_URL}}` with the clone URL of the new repo (`https://github.com/schnappapi/schnapp-kit.git`).
   - Replace `{{KIT_REPO_HTTPS}}` with `https://github.com/schnappapi/schnapp-kit`.
   - Replace `{{KIT_REPO_CREATED_AT_UTC}}` with the ISO-8601 timestamp at which you created the repo (UTC, second precision).
   - Replace `{{DEFAULT_BRANCH}}` with whatever the new repo's default branch is (it should be `main`).

That's the entire scope. Do not start building the kit yourself. The Mac Claude Code session (using HANDOFF-B) will do the actual build.

## Procedure

1. **Read these files** from `schnappapi/schnapp-bet` (branch `claude/awesome-cori-p23yR`), in order:
   - `.kit-bootstrap/README.md` (orientation)
   - `.kit-bootstrap/00-plan.md` (the approved plan)
   - `.kit-bootstrap/HANDOFF-B-template.md` (the template you'll customize)

   You do not need to read parts 01–06 in this session — Claude Code on the Mac will read those.

2. **Create the repo** via GitHub MCP `create_repository`:
   - `owner`: `schnappapi`
   - `name`: `schnapp-kit`
   - `description`: `Reusable Claude Code kit: ECC core + cherry-picked third-party plugins + schnapp-bet promotions, layered for selective adoption across projects. v1 — a starting point, not finished.`
   - `private`: `false`
   - `autoInit`: `true` (creates the placeholder README and default branch)

3. **Customize the template.** Fetch `HANDOFF-B-template.md`, substitute the four placeholders above, and write the result to `.kit-bootstrap/HANDOFF-B-claude-code.md` (same branch on schnapp-bet) via GitHub MCP `create_or_update_file`. Commit message:

   ```
   docs: [meta] generate HANDOFF-B-claude-code.md for Mac session — schnapp-kit repo created
   ```

   IMPORTANT — schnapp-bet enforces a commit-msg format via `.githooks/commit-msg`. The format above is valid (`docs: [meta] <description>`). Do not deviate.

4. **Reply to the user** with:
   - The new repo URL.
   - A one-line confirmation that `HANDOFF-B-claude-code.md` is committed.
   - The exact next step: open a Claude Code session on Schnapps-MBP, `cd ~/code/schnapp-bet && git pull`, then paste the contents of `.kit-bootstrap/HANDOFF-B-claude-code.md` as the first message.

## Boundaries

- **Do NOT** push files other than the placeholder README to schnapp-kit. The Mac session does the build.
- **Do NOT** delete `.kit-bootstrap/` from schnapp-bet. The Mac session does that as part of its cleanup.
- **Do NOT** make any commits to schnapp-bet on branches other than `claude/awesome-cori-p23yR`.
- **Do NOT** modify any of the bootstrap part files (00–06). They are the source of truth for the Mac session.
- If your GitHub MCP integration lacks `create_repository` scope (returns 403), stop and report. The user will need to either create the empty repo manually with `gh repo create schnappapi/schnapp-kit --public --add-readme` or expand your session's GitHub permissions.

## Why this two-step exists

The originating Claude session was scoped to schnapp-bet only and couldn't create new repos. The Mac Claude Code session can do the heavy lifting but is most efficient when handed a single paste-ready prompt with the new repo URL embedded. You're the bridge between the two.

--- END PASTE ---
