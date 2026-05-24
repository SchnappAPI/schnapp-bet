#!/bin/bash
# PreToolUse(Bash): block destructive commands per CLAUDE.md non-negotiable.
# Bypass: touch .claude/.allow-destructive (single-use, removed after match).

INPUT=$(cat)
CMD=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

if [[ -z "$CMD" ]]; then
  exit 0
fi

# Patterns drawn from CLAUDE.md "Never run X without explicit confirmation".
# Case-insensitive SQL keywords; -E for ERE.
PATTERNS=(
  '(^|[^A-Za-z_])DROP[[:space:]]+TABLE([^A-Za-z_]|$)'
  '(^|[^A-Za-z_])DROP[[:space:]]+DATABASE([^A-Za-z_]|$)'
  '(^|[^A-Za-z_])TRUNCATE([^A-Za-z_]|$)'
  'git[[:space:]]+reset[[:space:]]+--hard'
  'git[[:space:]]+push[[:space:]]+(-f|--force)'
  'git[[:space:]]+branch[[:space:]]+-D'
  'rm[[:space:]]+(-[a-zA-Z]*[rR][fF]?|-[a-zA-Z]*[fF][rR])'
  '--no-verify'
)

BYPASS="${CLAUDE_PROJECT_DIR:-.}/.claude/.allow-destructive"

for pat in "${PATTERNS[@]}"; do
  if echo "$CMD" | grep -qEi -- "$pat"; then
    if [[ -f "$BYPASS" ]]; then
      rm -f "$BYPASS"
      echo "destructive-guard: bypass consumed for pattern '$pat'" >&2
      exit 0
    fi
    cat >&2 <<EOF
destructive-guard: blocked command matches pattern '$pat'.
Command: $CMD
To proceed, create the single-use bypass file:
  touch ${BYPASS}
then re-run. The file is removed automatically on first match.
EOF
    exit 2
  fi
done

exit 0
