#!/bin/bash
# Stop hook — fires at end of every Claude turn.
# Guard: exit immediately if we already triggered a continuation to avoid infinite loops.
INPUT=$(cat)
if [ "$(echo "$INPUT" | jq -r '.stop_hook_active')" = "true" ]; then
  exit 0
fi

# Note: the changelog file no longer exists (ADR-20260517-4). The commit subject IS the
# changelog entry; format is enforced by discipline + ADR-20260517-4, not by this hook.

# Safety net for the post-commit auto-push hook: if HEAD is ahead of its
# upstream, push it. Covers post-commit failures (network blip) and clones
# where core.hooksPath was not yet set when the commit landed.
LOCAL=$(git -C "${CLAUDE_PROJECT_DIR}" rev-parse HEAD 2>/dev/null)
UPSTREAM=$(git -C "${CLAUDE_PROJECT_DIR}" rev-parse '@{u}' 2>/dev/null)
if [[ -n "$LOCAL" && -n "$UPSTREAM" && "$LOCAL" != "$UPSTREAM" ]]; then
  AHEAD=$(git -C "${CLAUDE_PROJECT_DIR}" rev-list --count "${UPSTREAM}..HEAD" 2>/dev/null)
  if [[ "$AHEAD" -gt 0 ]]; then
    echo "[stop-reminder] HEAD is $AHEAD commit(s) ahead of origin — pushing." >&2
    git -C "${CLAUDE_PROJECT_DIR}" push --quiet 2>&1 | sed 's/^/[stop-reminder] /' >&2 || true
  fi
fi

exit 0
