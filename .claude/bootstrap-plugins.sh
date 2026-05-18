#!/bin/bash
# Installs the plugins declared in .claude/settings.json if missing.
# Intended for fresh sandbox/agent sessions; idempotent on the Mac.
# Note: a plugin newly installed by this hook may not register until the next session start.

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
