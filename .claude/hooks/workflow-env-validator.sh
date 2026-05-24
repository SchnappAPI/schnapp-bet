#!/bin/bash
# PostToolUse(Edit|Write): lint .github/workflows/*.yml for env-block
# completeness against .claude/rules/workflows.md. Non-blocking — emits
# warnings to stderr only.
#
# Detection is heuristic and shallow: it grep's the yaml itself for tokens
# that signal a required env var. Cross-file analysis (which Python script
# the workflow runs, what it imports) is out of scope; the goal is to catch
# the common forget-to-add-PYTHONPATH-on-a-new-shared/-importer regression.

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

case "$FILE_PATH" in
  */.github/workflows/*.yml|*/.github/workflows/*.yaml) ;;
  *) exit 0 ;;
esac

# Skip workflows that explicitly don't touch the stack: claude.yml is a
# Claude Code action, refresh-data.yml is a UI-driven trigger, etc.
case "$(basename "$FILE_PATH")" in
  claude.yml) exit 0 ;;
esac

WARN=()

# Required for any workflow that imports from shared/.
if grep -qE 'shared\.(db|integrity)|from shared|import shared|etl/|grading/' "$FILE_PATH"; then
  if ! grep -qE 'PYTHONPATH:\s*/Users/schnapp/code/schnapp-bet' "$FILE_PATH"; then
    WARN+=("missing PYTHONPATH=/Users/schnapp/code/schnapp-bet (workflow imports from shared/ or runs etl/grading scripts)")
  fi
fi

# Required for any workflow that touches SQL Server.
if grep -qE 'SQL_SERVER|SQL_DATABASE|sql-server|mssql' "$FILE_PATH"; then
  for v in SQL_SERVER SQL_DATABASE SQL_USERNAME SQL_PASSWORD SQL_TRUST_CERT; do
    if ! grep -qE "(^|[^A-Z_])${v}:" "$FILE_PATH"; then
      WARN+=("missing env var ${v} (workflow references SQL Server)")
    fi
  done
fi

# Required for odds workflows.
if grep -qE 'odds_etl|odds-etl|ODDS_API_KEY|oddsapi\.io' "$FILE_PATH"; then
  if ! grep -qE 'ODDS_API_KEY:' "$FILE_PATH"; then
    WARN+=("missing ODDS_API_KEY (workflow runs odds ETL)")
  fi
fi

# Required for stats.nba.com callers.
if grep -qE 'nba_etl|stats\.nba\.com|nba_live' "$FILE_PATH"; then
  if ! grep -qE 'NBA_PROXY_URL:' "$FILE_PATH"; then
    WARN+=("missing NBA_PROXY_URL (workflow calls stats.nba.com — requires Webshare proxy)")
  fi
fi

# Required for Flask-talking workflows.
if grep -qE 'mac-flask\.schnapp\.bet|RUNNER_URL|RUNNER_API_KEY' "$FILE_PATH"; then
  if ! grep -qE 'RUNNER_API_KEY:' "$FILE_PATH"; then
    WARN+=("missing RUNNER_API_KEY (workflow talks to the Flask runner)")
  fi
fi

# Per ADR-20260517-5: secrets must come from 1Password, not GitHub repo secrets.
# A workflow that references secrets.SQL_* etc. directly is non-compliant.
if grep -qE 'secrets\.(SQL_|ODDS_API_KEY|NBA_PROXY_URL|RUNNER_API_KEY|ANTHROPIC_API_KEY)' "$FILE_PATH"; then
  WARN+=("uses secrets.* directly — ADR-20260517-5 requires 1password/load-secrets-action@v2 with op:// URIs")
fi

# Per rules/workflows.md: self-hosted runner required for any workflow
# that touches the local SQL container or imports from shared/.
if grep -qE 'shared\.(db|integrity)|from shared|SQL_SERVER:' "$FILE_PATH"; then
  if ! grep -qE 'runs-on:\s*\[\s*self-hosted' "$FILE_PATH"; then
    WARN+=("missing 'runs-on: [self-hosted, mac-runner]' — DB/shared workflows cannot run on ubuntu-latest")
  fi
fi

if [[ ${#WARN[@]} -gt 0 ]]; then
  echo "workflow-env-validator: $FILE_PATH" >&2
  for w in "${WARN[@]}"; do
    echo "  warn: $w" >&2
  done
fi

exit 0
