---
'clawmini': patch
---

Add `clawmini-lite history` and the underlying `getThreadHistory` agent endpoint, so an agent can read prior turns of the user-visible chat — even ones written by an earlier agent session it did not author. The endpoint returns user/agent messages oldest-first with `--before` cursor pagination, filters out tool/command/policy/subagent traffic and `displayRole: 'agent'` auto-replies, and rejects subagent tokens. The gemini-claw template now points the agent at this command in its `# Messaging` guidance.
