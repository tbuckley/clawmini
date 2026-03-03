# PRD Questions

**Q1: Are fallbacks evaluated strictly one-by-one in the array sequence (meaning each fallback configuration only gets one attempt before moving to the next), or should a single fallback have its own retry count (e.g., trying the exact same fallback multiple times before giving up)?**
A1: Let's add an optional retry count per fallback; defaults to 1.

**Q2: For the notification message ("Error running agent, retrying in N seconds..."), should this be appended as a new system message to the chat that remains in the history, or should we update/replace a temporary message, or just include it as standard `stderr` output in the final message log?**
A2: This should be a new "log" message in the chat that is immediately sent to the user and persists.

**Q3: Should the delay for fallbacks and their retries use a fixed delay or an exponential backoff strategy? Additionally, should we add a command execution `timeoutMs` to detect if an agent hangs and trigger a fallback based on that timeout?**
A3: Use whatever is recommended for retries, but cap the retry delay at something reasonable (15s). No timeout is needed for the commands themselves.
