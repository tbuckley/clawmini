#!/usr/bin/env bash
set -euo pipefail

export LANG="${LANG:-en_US.UTF-8}" LC_ALL="${LC_ALL:-en_US.UTF-8}"

printf '%s\t%s\tcwd=%s\n' "$(date -Is)" "clawmini-tool-logging" "${PWD}" >> /home/user/.codex/hook-debug.log

if ! command -v clawmini-lite.js >/dev/null 2>&1; then
  exit 0
fi

input="$(cat)"
tool_name="$(printf '%s' "${input}" | jq -r '.tool_name')"
tool_input="$(printf '%s' "${input}" | jq -c '.tool_input')"

printf '%s\t%s\ttool_name=%s\ttool_input=%s\n' "$(date -Is)" "clawmini-tool-logging" "${tool_name}" "${tool_input}" >> /home/user/.codex/hook-debug.log

clawmini-lite.js tool "${tool_name}" "${tool_input}" >/dev/null 2>&1 || true