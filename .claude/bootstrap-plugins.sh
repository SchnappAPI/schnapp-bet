#!/bin/bash
# Installs the plugins declared in .claude/settings.json if missing, and
# activates the repo's version-controlled git hooks (`.githooks/`) in this
# clone. Both steps are idempotent.
# Note: a plugin newly installed by this hook may not register until the next session start.

# Activate version-controlled git hooks (auto-push on commit, etc.).
# Silent no-op if already set or if not run inside the repo's worktree.
if [ -n "${CLAUDE_PROJECT_DIR}" ] && [ -d "${CLAUDE_PROJECT_DIR}/.githooks" ]; then
  git -C "${CLAUDE_PROJECT_DIR}" config --local core.hooksPath .githooks 2>/dev/null || true
fi

command -v claude >/dev/null 2>&1 || exit 0

PLUGINS=(
  "claude-code-setup@claude-plugins-official"
  "claude-md-management@claude-plugins-official"
  "claude-mem@thedotmack"
  "code-simplifier@claude-plugins-official"
  "commit-commands@claude-plugins-official"
  "feature-dev@claude-plugins-official"
  "frontend-design@claude-plugins-official"
  "github@claude-plugins-official"
  "greptile@claude-plugins-official"
  "hookify@claude-plugins-official"
  "plugin-dev@claude-plugins-official"
  "pyright-lsp@claude-plugins-official"
  "ralph-loop@claude-plugins-official"
  "remember@claude-plugins-official"
  "session-report@claude-plugins-official"
  "skill-creator@claude-plugins-official"
  "superpowers@claude-plugins-official"
)

INSTALLED=$(claude plugin list 2>/dev/null || echo "")

for p in "${PLUGINS[@]}"; do
  if ! echo "$INSTALLED" | grep -qF "$p"; then
    echo "Installing $p..." >&2
    claude plugin install "$p" >&2 2>&1 || echo "Failed to install $p" >&2
  fi
done

exit 0
