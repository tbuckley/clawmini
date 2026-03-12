#!/bin/bash

# Fetch pending items
OUTPUT=$(clawmini-lite.js fetch-pending 2>/dev/null)

# Output valid JSON with the result if not empty
if [ -n "$OUTPUT" ]; then
  jq -n --arg out "$OUTPUT" '{hookSpecificOutput: {additionalContext: $out}}'
fi
