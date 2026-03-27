# Chat Logs Cleanup - Tickets

## Ticket 1: Define New Message Taxonomy
**Description**: Refactor `src/shared/chats.ts` to define the expanded `ChatMessage` union and interfaces (`BaseMessage`, `UserMessage`, `AgentReplyMessage`, `LogMessage`, `CommandLogMessage`, `SystemMessage`, `ToolMessage`, `PolicyRequestMessage`, `SubagentStatusMessage`, `LegacyLogMessage`), including the new `displayRole` property.
**Verification**: 
- Ensure TypeScript compiles successfully.
- Run `npm run validate`.
**Status**: Completed

## Ticket 2: Implement Legacy-Aware Parsing
**Description**: Update the chat history loading logic (likely in `src/shared/chats.ts` or `src/daemon/agent/chat-logger.ts`) to handle legacy messages gracefully. Map older `role: 'log'` messages to `role: 'legacy_log'` to ensure backwards compatibility. 
**Verification**:
- Add unit tests verifying legacy chat logs are parsed correctly.
- Run `npm run validate`.
**Status**: Completed

## Ticket 3: Update Chat Logger Methods
**Description**: Update `src/daemon/agent/chat-logger.ts` to expose specific methods for the new message types (e.g., `logSystemMessage`, `logAgentReply`, `logToolMessage`, `logPolicyRequestMessage`).
**Verification**:
- Add unit tests for the new logging methods to verify the correct roles and structures are created.
- Run `npm run validate`.
**Status**: Completed

## Ticket 4: Add `reply` and `tool` Commands to CLI
**Description**: Implement `clawmini-lite reply` and `clawmini-lite tool <name> <payload>` commands to emit `AgentReplyMessage` and `ToolMessage` respectively. This replaces the overloaded use of `clawmini-lite log` for agent replies.
**Verification**:
- Add E2E tests for `clawmini-lite reply` and `clawmini-lite tool`, ensuring they run in an isolated sandbox temporary directory.
- Verify the generated messages map to the correct roles.
- Run `npm run validate`.
**Status**: Completed

## Ticket 5: Update Routers and Internal Hooks
**Description**: Refactor existing routers (e.g., `slash-policies.ts`, `agent-router.ts`) and system hooks to use the new specialized logging methods. Update cron jobs, subagent notifications, and policy requests to use `SystemMessage` and `PolicyRequestMessage` instead of masquerading as `UserMessage` or `CommandLogMessage`.
**Verification**:
- Update existing unit and integration tests for routers to expect the new message types.
- Run `npm run validate`.
**Status**: Completed

## Ticket 6: Update Adapters and Display Logic (Discord)
**Description**: Update `src/adapter-discord/` (and any other relevant adapters) to parse the new `ChatMessage` union. Implement the message forwarding logic using the `displayRole` property and ensure internal subagent messages are properly filtered or threaded.
**Verification**:
- Add unit tests verifying adapter filtering logic (e.g., skipping messages without `displayRole: 'agent'` and properly handling `subagentId`).
- Run `npm run validate`.
**Status**: Completed

## Ticket 7: Update Web UI to Handle New Message Types
**Description**: Update the SvelteKit frontend in `web/` to accept and render the new message types appropriately. Ensure `LegacyLogMessage` degrades gracefully (e.g., rendered as a generic code block or text node) and add interactive UI elements for `PolicyRequestMessage`.
**Verification**:
- Run Svelte diagnostics with `npm run check -w web`.
- Add or update frontend tests.
- Run `npm run validate`.
**Status**: Completed

## Ticket 8: Add `displayRole` to `SystemMessage` and Implement `SubagentStatusMessage`
**Description**: Update `SystemMessage` in `src/shared/chats.ts` to properly inherit or explicitly set `displayRole?: 'user' | 'agent'`. Update `logSystemMessage` in `src/daemon/agent/chat-logger.ts` to accept `displayRole` as a parameter. Update any existing usages of `logSystemMessage` to pass the `displayRole` if necessary. Also, add `logSubagentStatus` to emit `SubagentStatusMessage` and replace `logSystemEvent` in `src/daemon/api/subagent-utils.ts` with this new method. Ensure subagent messages have no `displayRole`.
**Verification**:
- Run `npm run validate`.
**Status**: Completed

## Ticket 9: Update `logAutomaticReply` to Emit `SystemMessage`
**Description**: Update `logAutomaticReply` in `src/daemon/agent/chat-logger.ts` to emit a `SystemMessage` with `event: 'router'` and `displayRole: 'agent'` instead of a `CommandLogMessage`. Update corresponding test cases. This ensures that responses from slash commands like `/pending`, `/new`, `/approve`, and `/reject` are correctly sent to users as system messages.
**Verification**:
- Run `npm run validate`.
**Status**: Completed

## Ticket 10: Update Policy Approval/Rejection Notifications
**Description**: In `src/daemon/routers/slash-policies.ts`, when a policy is approved or rejected, emit a `SystemMessage` with `event: 'policy_approved'` or `policy_rejected` and `displayRole: 'user'` to notify the agent. For approvals, ensure the system message includes the command's output so the agent can see it. Continue returning the string `reply` so that `logAutomaticReply` handles the user-facing confirmation.
**Verification**:
- Run `npm run validate`.
**Status**: Completed

## Ticket 11: Agent Command Final Output
**Description**: Implement logging the final output of agent commands to users. Update `logCommandResult` (or the place that calls it in `agent-session.ts`) to emit BOTH a `CommandLogMessage` (containing the raw command, stdout/stderr, etc.) AND an `AgentReplyMessage` containing the extracted (or raw) output. If the output strictly equals or contains `NO_REPLY_NECESSARY`, the `AgentReplyMessage` should be skipped. This ensures users see the results of agent actions natively in the UI.
**Verification**:
- Run `npm run validate`.
**Status**: Not Started
