#!/bin/bash
# Stop hook — fires at end of every Claude turn.
# Guard: exit immediately if we already triggered a continuation to avoid infinite loops.
INPUT=$(cat)
if [ "$(echo "$INPUT" | jq -r '.stop_hook_active')" = "true" ]; then
  exit 0
fi

# If code files were modified but CHANGELOG.md was not touched, remind.
CHANGED=$(git -C "${CLAUDE_PROJECT_DIR}" status --short 2>/dev/null \
  | grep -v 'CHANGELOG' \
  | grep -v '^\s*$' \
  | head -1)
CHANGELOG=$(git -C "${CLAUDE_PROJECT_DIR}" status --short 2>/dev/null \
  | grep 'CHANGELOG' \
  | head -1)

if [[ -n "$CHANGED" && -z "$CHANGELOG" ]]; then
  echo "REMINDER: files changed without a CHANGELOG entry. Update CHANGELOG.md before ending the session." >&2
fi
exit 0
