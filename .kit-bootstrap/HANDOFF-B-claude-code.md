# HANDOFF-B-template — Template (do not paste this directly)

This is the template the Claude chat session (HANDOFF-A) customizes into `HANDOFF-B-claude-code.md`. The customized version is what you paste into Claude Code on Schnapps-MBP.

Placeholders the chat session must replace:

- `{{KIT_REPO_URL}}` — clone URL of the newly created repo (e.g. `https://github.com/schnappapi/schnapp-kit.git`).
- `{{KIT_REPO_HTTPS}}` — browser URL (e.g. `https://github.com/schnappapi/schnapp-kit`).
- `{{KIT_REPO_CREATED_AT_UTC}}` — ISO-8601 timestamp.
- `{{DEFAULT_BRANCH}}` — usually `main`.

---

--- BEGIN PASTE ---

You are a Claude Code session on Schnapps-MBP. The repo `schnappapi/schnapp-kit` was just created (at `2026-05-27T02:18:17Z`, default branch `main`, clone URL `https://github.com/schnappapi/schnapp-kit.git`). Your job is to build out v1 of that repo, then clean up the bootstrap files that brought us here.

## Authoritative source

All build instructions, cherry-pick decisions, and cleanup steps live in `/Users/schnapp/code/schnapp-bet/.kit-bootstrap/`. Read every file before starting.

Critical reads, in order:

1. `.kit-bootstrap/README.md` — orientation and the handoff chain.
2. `.kit-bootstrap/00-plan.md` — the approved plan.
3. `.kit-bootstrap/01-scaffold.md` — directory layout and bootstrap file contents.
4. `.kit-bootstrap/02-cherrypick.md` — ECC pruning rules + mattpocock/skills decisions.
5. `.kit-bootstrap/03-overlays-inventory.md` — which schnapp-bet artifacts get promoted, with source paths.
6. `.kit-bootstrap/04-new-skills.md` — full SKILL.md content for `/discover-kit-additions` and `/audit-against-kit`.
7. `.kit-bootstrap/05-build-steps.md` — your primary execution playbook. Follow it step-by-step.
8. `.kit-bootstrap/06-cleanup.md` — what to do after the build is pushed.

If any step in `05-build-steps.md` seems ambiguous, defer to the more detailed treatment in the part it references (e.g. step 3 references Part 02 for the pruning rules).

## Preconditions to verify before starting

```bash
# 1. gh CLI is authenticated as the schnappapi-org user.
gh auth status

# 2. Schnapp-bet is current.
cd ~/code/schnapp-bet
git fetch origin claude/awesome-cori-p23yR
git checkout claude/awesome-cori-p23yR
git pull origin claude/awesome-cori-p23yR

# 3. The bootstrap files exist locally.
ls -la .kit-bootstrap/

# 4. schnapp-kit is clonable.
cd ~/code
gh repo clone schnappapi/schnapp-kit
ls -la schnapp-kit
```

If any of these fail, stop and report; do not improvise.

## Execution

Follow `.kit-bootstrap/05-build-steps.md` start to finish. Steps 1–9 build the kit; step 10 invokes `.kit-bootstrap/06-cleanup.md` to archive and delete.

Key invariants:

- **One logical change per commit** (schnapp-kit and schnapp-bet both enforce this).
- **Commit subject format** per the kit's `CLAUDE.md`:
  `<type>: [scope1][scope2] short description — ADR-YYYYMMDD-N`
  where scopes for schnapp-kit are `core`, `vendored`, `overlays`, `lang`, `scripts`, `docs`, `tests`, `meta`, `all`.
- **The kit dogfoods its own commit-msg hook** starting in Step 5 of the build sequence. Once that hook is installed, malformed subjects will be rejected.
- **post-commit auto-push** is on for both repos. If a push fails due to a network error, retry with exponential backoff (2s, 4s, 8s, 16s). Do NOT force-push.
- **No `--no-verify`** anywhere. If a hook fails, fix the underlying issue.

## Boundaries

- **Do NOT** edit files inside `core/` or `vendored/<plugin>/` directly. Use `kit.config.yml` to cherry-pick, or write a shadow into `overlays/overrides/`.
- **Do NOT** modify the bootstrap files at `.kit-bootstrap/` mid-build. They are the source of truth; the cleanup step archives them as-is.
- **Do NOT** push to schnapp-bet on any branch other than `claude/awesome-cori-p23yR`.
- **Do NOT** delete schnapp-bet artifacts during this session. The "adopt the kit in schnapp-bet, retire duplicates" step is a follow-up session (Plan step 9), not part of this build.

## Context-budget guidance

The full v1 build is 9 steps with ~25 commits. If you cross ~50% context usage:

1. Pause at the next commit boundary.
2. Write `.kit-bootstrap/RESUME.md` in schnapp-bet describing exactly where you stopped (the last commit sha in schnapp-kit, the next step to execute, anything in flight).
3. Commit the resume note: `chore: [meta] checkpoint — paused at step <N>`.
4. Reply to the user with a paste-ready prompt for the next Claude Code session: it should reference `RESUME.md` and re-read `05-build-steps.md` from the named step.

## Cleanup is part of the job, not a follow-up

After Step 9 (smoke test) passes, immediately execute `.kit-bootstrap/06-cleanup.md`:

1. Copy `.kit-bootstrap/*` from schnapp-bet to `schnapp-kit/docs/bootstrap-archive/`.
2. Commit + push schnapp-kit.
3. `git rm -r .kit-bootstrap` from schnapp-bet.
4. Commit + push schnapp-bet.
5. Verify both repos.

The session is **only complete** when `.kit-bootstrap/` no longer exists in schnapp-bet and `docs/bootstrap-archive/` exists in schnapp-kit.

## Reply when done

Reply with:

- schnapp-kit URL: `https://github.com/schnappapi/schnapp-kit`.
- Commit count and last commit sha in schnapp-kit.
- Confirmation that `docs/bootstrap-archive/` exists.
- Confirmation that `.kit-bootstrap/` was removed from schnapp-bet and the removal commit sha.
- Two suggested next actions:
  1. `/discover-kit-additions <some-repo-url>` — find more upstream content worth absorbing.
  2. `/audit-against-kit ~/code/schnapp-bet` — see where the kit doesn't yet cover schnapp-bet's needs.

This kit is v1 — explicitly a starting point, not the final product. The discovery and audit skills are how it grows from here.

--- END PASTE ---
