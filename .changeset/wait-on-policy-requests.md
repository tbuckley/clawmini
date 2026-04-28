---
"clawmini": patch
---

Guide the agent to wait on queued policy requests instead of polling. The
`clawmini-requests` skill and the `request <policy>` CLI output now make
clear that a returned Request ID means the command has not yet run, the
result will arrive as a new user message after approval, and the agent
should finish unrelated work and end its turn rather than loop checking
status.
