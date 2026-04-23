#!/usr/bin/env bash
set -euo pipefail

printf '%s\t%s\tcwd=%s\n' "$(date -Is)" "clawmini-insert-pending" "${PWD}" >> /home/user/.codex/hook-debug.log

if ! command -v clawmini-lite.js >/dev/null 2>&1; then
  exit 0
fi

output="$(clawmini-lite.js fetch-pending 2>/dev/null || true)"

if [ -z "${output}" ]; then
  exit 0
fi

hook_event_name="$(jq -r '.hook_event_name // "PostToolUse"' < /dev/stdin 2>/dev/null || printf '%s' "PostToolUse")"

printf '%s\t%s\thook_event_name=%s\n' "$(date -Is)" "clawmini-insert-pending" "${hook_event_name}" >> /home/user/.codex/hook-debug.log

jq -n \
  --arg hook_event_name "${hook_event_name}" \
  --arg out "${output}" \
  '{
    hookSpecificOutput: {
      hookEventName: $hook_event_name,
      additionalContext: $out
    }
  }'