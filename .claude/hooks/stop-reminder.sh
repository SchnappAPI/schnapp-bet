#!/bin/bash
# Stop hook — fires at end of every Claude turn.
# Guard: exit immediately if we already triggered a continuation to avoid infinite loops.
INPUT=$(cat)
if [ "$(echo "$INPUT" | jq -r '.stop_hook_active')" = "true" ]; then
  exit 0
fi

# If code files were modified but no docs/changelog/ file was touched, remind.
CHANGED=$(git -C "${CLAUDE_PROJECT_DIR}" status --short 2>/dev/null \
  | grep -v 'docs/changelog/' \
  | grep -v '^\s*$' \
  | head -1)
CHANGELOG=$(git -C "${CLAUDE_PROJECT_DIR}" status --short 2>/dev/null \
  | grep 'docs/changelog/' \
  | head -1)

if [[ -n "$CHANGED" && -z "$CHANGELOG" ]]; then
  echo "REMINDER: files changed without an entry in docs/changelog/YYYY.md. Append one before ending the session." >&2
fi

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
