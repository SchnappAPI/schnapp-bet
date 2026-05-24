#!/bin/bash
# PreToolUse(Edit|Write): enforce the append-only ADR invariant from
# .claude/rules/docs.md. Shipped ADRs (already on HEAD) cannot be edited;
# a new ADR with `Supersedes:` is the documented path.
#
# Bypass: touch .claude/.allow-adr-edit  (single-use, consumed on first match).
# Use only for typo-grade corrections within minutes of shipping. Substantive
# revisions still require a superseding ADR.

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

if [[ -z "$FILE_PATH" ]]; then
  exit 0
fi

# Normalize to a repo-relative path so `git cat-file` works regardless of cwd.
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"
case "$FILE_PATH" in
  /*) REL_PATH="${FILE_PATH#${PROJECT_DIR}/}" ;;
  *)  REL_PATH="$FILE_PATH" ;;
esac

# Only fire on docs/decisions/ADR-*.md files.
case "$REL_PATH" in
  docs/decisions/ADR-*.md) ;;
  *) exit 0 ;;
esac

# README.md in docs/decisions/ is not an ADR.
if [[ "$(basename "$REL_PATH")" == "README.md" ]]; then
  exit 0
fi

# If the file is not yet on HEAD, this is the initial author write — allowed.
if ! (cd "$PROJECT_DIR" && git cat-file -e "HEAD:$REL_PATH" 2>/dev/null); then
  exit 0
fi

BYPASS="${PROJECT_DIR}/.claude/.allow-adr-edit"
if [[ -f "$BYPASS" ]]; then
  rm -f "$BYPASS"
  echo "protect-shipped-adrs: bypass consumed for $REL_PATH" >&2
  exit 0
fi

cat >&2 <<EOF
protect-shipped-adrs: blocked edit to a shipped ADR.
File: $REL_PATH

ADRs are append-only per .claude/rules/docs.md. To revise a prior decision,
write a new ADR with a Supersedes: line pointing back. Use /skill adr-writer
or the /adr command to compute the next counter.

If this is a typo-grade correction within minutes of shipping, single-use bypass:
  touch ${BYPASS}
then re-run. The file is removed on first match.
EOF
exit 2
