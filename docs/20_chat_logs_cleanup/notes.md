# Findings: Chat Logs Cleanup

## Audit of Chat Messages Logging Locations

1. **`src/daemon/message.ts` (handleUserMessage)**
   - Initial user prompt is logged via `logUserMessage` as `UserMessage` (role: 'user').
   - Router replies (e.g. from `/pending`, `/new`, `/approve`, `/reject`) are logged via `logAutomaticReply`, which currently emits a `CommandLogMessage` with `command: 'router'`.

2. **`src/daemon/agent/chat-logger.ts`**
   - `logUserMessage`: emits `UserMessage`.
   - `logCommandResult`: emits `CommandLogMessage`. (Note: The user requested that "When an agent runs a command, the final output should be stored in an AgentReplyMessage (if it isn't NO_REPLY_NECESSARY)." This means `logCommandResult` needs to be updated to optionally emit an `AgentReplyMessage` instead of or alongside the `CommandLogMessage`).
   - `logSystemEvent`: currently emits `CommandLogMessage`. (Needs to be replaced by `logSystemMessage`).
   - `logAutomaticReply`: currently emits `CommandLogMessage`. (Needs to be updated to emit `SystemMessage` with `displayRole: 'agent'`).
   - `logCommandRetry`: currently emits `CommandLogMessage` with `command: 'retry-delay'`.
   - `logSystemMessage`, `logAgentReply`, `logToolMessage`, `logPolicyRequestMessage`: recently added.

3. **`src/daemon/routers/slash-policies.ts`**
   - `/pending`: returns a `reply` string, which is logged by `logAutomaticReply`.
   - `/approve` and `/reject`: currently log a `CommandLogMessage` (for approve execution) and `PolicyRequestMessage` (for reject), and return a `reply`.
   - User requested: "When the user runs /pending, the reponse should be a SystemMessage with displayRole=agent; they should get the same when the approve/reject a policy (and the agent should receive a SystemMessage with displayRole=user)."
   - So `/approve` and `/reject` should emit a `SystemMessage` with `displayRole: 'user'` to notify the agent, and their `reply` will be handled by the updated `logAutomaticReply` (which emits `SystemMessage` with `displayRole: 'agent'` to notify the user).

4. **`src/daemon/api/agent-router.ts`**
   - `logMessage` API: logs `CommandLogMessage` (for agent silent logs).
   - `logReplyMessage` API: logs `AgentReplyMessage` (for agent visible replies).
   - `createPolicyRequest`: logs `PolicyRequestMessage`.

5. **`src/daemon/api/subagent-utils.ts`**
   - Calls `logSystemEvent` for "Subagent completed" and "Subagent failed". Needs to be updated to `logSystemMessage` with `event: 'subagent_update'` and `displayRole: 'user'`.

## Goals
- Break down the overloaded `CommandLogMessage` into specialized types that actually represent what happened.
- Provide clear types for:
  - The initial User Message
  - The Agent's Response (AgentMessage / AssistantMessage)
  - Tool Executions (command, cwd, output)
  - System Events (notifications, retries, auto-replies)
  - Policy Requests / Approvals
- Scalable design for adapters to selectively filter and display messages based on type.

## Questions that need answering
1. **Agent Command Output:** The user requested "When an agent runs a command, the final output should be stored in an AgentReplyMessage (if it isn't NO_REPLY_NECESSARY)." Does this mean `logCommandResult` should emit an `AgentReplyMessage` *instead* of a `CommandLogMessage`, or *in addition* to it? If it's an `AgentReplyMessage`, it loses structured fields like `command`, `cwd`, and `exitCode`. Should it be wrapped in the `content` of the `AgentReplyMessage`?
2. **SystemMessage displayRole:** We need to add the `displayRole?: 'user' | 'agent'` property to `BaseMessage` or `SystemMessage` in `shared/chats.ts` so that `SystemMessage` can carry it.
