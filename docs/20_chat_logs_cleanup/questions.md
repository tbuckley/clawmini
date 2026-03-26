# Questions for Chat Logs Cleanup

1. **Agent Responses:** Since agent responses are currently just another "log" message (via `clawmini-lite log` or similar shell outputs), should we introduce a dedicated `AssistantMessage` (or `AgentMessage`) type specifically for the LLM's natural language responses to the user? If so, how should the daemon/agent populate this type moving forward?
   - **Answer:** We don't need a single `AgentMessage`. We should track different types of messages:
     - Output of running an agent command (`role: 'log'`).
     - Messages the agent sends specifically to the user via a CLI tool (e.g., `clawmini-lite reply` instead of `log`) (`role: 'agent'`).
     - Automatic replies from routers (`role: 'router'`).
2. **System Injections:** How should we handle system messages currently masquerading as the user (e.g. automated jobs, policy approvals, subagent notifications)? Should we add a `SystemMessage` type for these instead of reusing `UserMessage`?
   - **Answer:** Yes, a `SystemMessage` or `SystemNotification` type makes sense here.
3. **Proposed Taxonomy:** Does the following new message type taxonomy align with your vision?
   - `UserMessage`: `role: 'user'` (strictly for actual user text input)
   - `AssistantMessage`: `role: 'assistant'` (strictly for actual agent natural language responses)
   - `ToolCallMessage`: `role: 'tool'` (for executed commands and their outputs, replacing the standard `CommandLogMessage`)
   - `SystemMessage`: `role: 'system'` (for system events, retries, auto-replies, cron jobs, etc.)
   - `PolicyMessage`: `role: 'policy'` (for policy requests, approvals, and rejections)
   - **Answer:** `role: tool` is too narrow, just use `role: log`. `role: policy` should be for the message requesting approve/deny from the user. After that, we send a `SystemMessage` to the agent and the user to confirm the action.

*All questions resolved. Proceeding to PRD.*
