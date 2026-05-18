#!/bin/bash
INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

# Allowlist: files that look protected by substring but are documented as
# secret-free. .env.template carries only `op://` URIs per ADR-20260517-5.
# services/launchd/*.plist contain no embedded secrets — the wrapper script
# sources OP_SERVICE_ACCOUNT_TOKEN at runtime and `op run` resolves the rest.
ALLOWED=(".env.template" "services/launchd/")
for allowed in "${ALLOWED[@]}"; do
  if [[ "$FILE_PATH" == *"$allowed"* ]]; then
    exit 0
  fi
done

PROTECTED=(".env" "package-lock.json" ".git/" "sql-server.env" ".plist")

for pattern in "${PROTECTED[@]}"; do
  if [[ "$FILE_PATH" == *"$pattern"* ]]; then
    echo "Blocked: $FILE_PATH matches protected pattern '$pattern'" >&2
    exit 2
  fi
done

exit 0
