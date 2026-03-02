#!/usr/bin/env bash
# Ensure UTF-8 so emoji in log message prints correctly
export LANG="${LANG:-en_US.UTF-8}" LC_ALL="${LC_ALL:-en_US.UTF-8}"

# Read hook input from stdin
input=$(cat)

# Extract tool name (requires jq)
tool_name=$(echo "$input" | jq -r '.tool_name')
tool_input=$(echo "$input" | jq -rc '.tool_input')

# Note: This assumes the clawmini-lite.js script is on your PATH
clawmini-lite.js log "🛠️ $tool_name: $tool_input"