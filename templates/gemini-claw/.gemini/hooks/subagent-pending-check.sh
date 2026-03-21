#!/bin/bash

# Suppress stderr to avoid polluting the terminal if not a subagent
OUTPUT=$(clawmini-lite.js tasks pending 2>/dev/null)
EXIT_CODE=$?

# Only runs successfully (exit code 0) for subagents. Main agents will exit with non-zero.
if [ $EXIT_CODE -eq 0 ]; then
  # It's a subagent. Let's see if there are any pending tasks.
  # The output prints "  - <id>" for pending tasks.
  if echo "$OUTPUT" | grep -q "  - "; then
    jq -n '{
      "decision": "deny",
      "reason": "you must await ongoing asynchronous tasks (use '\''clawmini-lite tasks pending'\'' and '\''tasks wait <id>'\'')"
    }'
  fi
fi
