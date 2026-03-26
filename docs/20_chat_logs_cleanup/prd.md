# Product Requirements Document: Chat Logs Cleanup

## 1. Vision

To redesign the chat message storage and logging system in Gemini CLI so that different types of messages (user inputs, command logs, system events, agent replies, and policy requests) are structurally distinct. This will enable user interfaces (like the web chat or Discord adapter) to granularly filter, format, and interact with specific message types, paving the way for advanced features like inline interactive policy approvals and subagent thread views.

## 2. Product / Market Background

Currently, the chat logging system primarily relies on two overloaded message roles: `user` and `log`.

- `user` is used not only for actual user input, but also for system injections (like cron job triggers or policy approval notifications) masquerading as the user.
- `log` (`CommandLogMessage`) is used for everything else: tool execution results, agent text replies (via `clawmini-lite log`), router automatic replies, retry delays, and more.

As the system scales to include background jobs, subagents, and strict policy requests, lumping these diverse events into two buckets makes it difficult to provide a clean, sensible UI. Adapters must rely on heuristics to figure out if a "log" is something the user actually needs to read or just background noise.

## 3. Requirements

### 3.1. Message Type Taxonomy

The `ChatMessage` union type will be expanded into a structured set of distinct message types.

```typescript
export interface BaseMessage {
  id: string;
  role: string;
  displayRole?: 'user' | 'agent'; // Tells the adapter whether to show this as a user prompt or agent reply, and tells the LLM how to format history
  content: string; // The text content of the message. For structured messages (like tool calls or logs), this can be empty and constructed only when emitted to adapters.
  timestamp: string;
  subagentId?: string; // If this message belongs to a subagent thread
}

export interface UserMessage extends BaseMessage {
  role: 'user';
  // If the router or system modified the user's prompt before sending it to the agent,
  // the final text is stored here. If absent, the agent received 'content'.
  agentContent?: string;
  files?: string[];
}

export interface AgentReplyMessage extends BaseMessage {
  role: 'agent';
  files?: string[];
}

// Emitted when the agent explicitly wants to log a note or file silently
export interface LogMessage extends BaseMessage {
  role: 'log';
  messageId: string; // The ID of the UserMessage/SystemMessage that initiated this thought
  type?: 'tool' | 'unknown';
}

// Emitted whenever the daemon executes a command (agent tools, policies, retries)
export interface CommandLogMessage extends BaseMessage {
  role: 'command';
  messageId: string; // The ID of the UserMessage/SystemMessage that initiated this command
  command: string;
  cwd: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  // If this command failed and is being retried, we can track the attempt number here
  retryAttemptIndex?: number;
}

// Emitted for orchestration, cron jobs, policy approval confirmations, and subagent wakeups
export interface SystemMessage extends BaseMessage {
  role: 'system';
  event: 'cron' | 'policy_approved' | 'policy_rejected' | 'subagent_update' | 'router' | 'other';
  messageId?: string; // Optional correlation ID
}

export interface ToolMessage extends BaseMessage {
  role: 'tool';
  messageId: string;
  name: string;
  payload: unknown;
}

export interface PolicyRequestMessage extends BaseMessage {
  role: 'policy';
  messageId: string;
  requestId: string;
  commandName: string;
  args: string[];
  status: 'pending' | 'approved' | 'rejected';
}

// Emitted when a subagent completes or fails. These may only be emitted to clients and not stored in the chat log permanently.
export interface SubagentStatusMessage extends BaseMessage {
  role: 'subagent_status';
  subagentId: string;
  status: 'completed' | 'failed';
}

// Legacy log messages imported from older chat histories
export interface LegacyLogMessage extends BaseMessage {
  role: 'legacy_log';
  messageId?: string;
  source?: string;
  files?: string[];
  level?: 'default' | 'debug' | 'verbose';
  command?: string;
  cwd?: string;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
}

export type ChatMessage =
  | UserMessage
  | AgentReplyMessage
  | LogMessage
  | CommandLogMessage
  | SystemMessage
  | ToolMessage
  | PolicyRequestMessage
  | SubagentStatusMessage
  | LegacyLogMessage;
```

### 3.2. Existing Flows and Their New Message Types

The following details how existing logging flows will be migrated to the new taxonomy:

1. **Normal User Prompt**
   - _Current:_ `UserMessage` (`role: 'user'`)
   - _New:_ `UserMessage` (`role: 'user'`)

2. **Agent Executes a Tool/Command**
   - _Current:_ `CommandLogMessage` (`role: 'log'`)
   - _New:_ `CommandLogMessage` (`role: 'command'`). Visibility controls can replace the old `level: 'verbose'` property.

3. **Agent Sends a Message to the User**
   - _Current:_ Agent calls `clawmini-lite log "Hello"`, which saves as a `CommandLogMessage`.
   - _New:_ Agent calls `clawmini-lite reply "Hello"`. This emits an `AgentReplyMessage` (`role: 'agent'`).

4. **Agent Logs Background Info Silently**
   - _Current:_ Agent calls `clawmini-lite log "Note" --file ...`
   - _New:_ Agent calls `clawmini-lite log "Note" --file ...`. This emits a `LogMessage` (`role: 'log'`).

5. **Router Automatic Replies (e.g., `/new`, `/stop`)**
   - _Current:_ `CommandLogMessage` with `source: 'router'` or `command: 'router'`.
   - _New:_ `SystemMessage` (`role: 'system'`, `event: 'router'`, `displayRole: 'agent'`).

6. **Policy Request is Pending**
   - _Current:_ No dedicated chat message, just held in the request store.
   - _New:_ `PolicyRequestMessage` (`role: 'policy'`, `status: 'pending'`). The UI renders "Approve / Reject" buttons.

7. **Policy Request is Approved/Rejected**
   - _Current:_ Saves a `CommandLogMessage` describing the approval/rejection.
   - _New:_
     - 1. Emits a `SystemMessage` (`role: 'system'`, `event: 'policy_approved'` or `policy_rejected`, `displayRole: 'user'`) sent to the agent to notify it of the action.
     - 2. Emits a `SystemMessage` (`role: 'system'`, `event: 'router'`, `displayRole: 'agent'`) to confirm the action to the user in the UI.
     - 3. Emits a `CommandLogMessage` (`role: 'command'`) recording the actual command execution of the policy.

8. **Subagent Notifications / Lifecycle**
   - _Current:_ Appends string to `executeDirectMessage` which saves as a `UserMessage`.
   - _New:_ `SystemMessage` (`role: 'system'`, `event: 'subagent_update'`, `displayRole: 'user'`). Wakes up the parent agent without masquerading as the user.

9. **Cron Job Triggers / Background Injections**
   - _Current:_ Injected as `UserMessage` to wake up the agent.
   - _New:_ `SystemMessage` (`role: 'system'`, `event: 'cron'`, `displayRole: 'user'`). Wakes up the agent.

10. **Command Retries (`retry-delay`)**
    - _Current:_ `CommandLogMessage` with `command: 'retry-delay'`.
    - _New:_ Emits a `CommandLogMessage` (`role: 'command'`) for the failed attempt, with `retryAttemptIndex: 0`. The fallback execution will then emit a subsequent `CommandLogMessage` for the retry with incremented indices.

11. **Agent Decides to Call a Tool**
    - _Current:_ Implicitly merged with the tool execution result or unrecorded outside the LLM context.
    - _New:_ A system hook will detect the LLM's tool call and automatically execute `clawmini-lite tool <name> <payload>`. This ensures the intent is logged and an explicit `ToolMessage` (`role: 'tool'`) is emitted without requiring extra manual steps from the LLM.

### 3.3. Adapters & Display Logic

Chat adapters (Web UI, Discord) will be updated to handle the new `ChatMessage` union via the `displayRole` property.

**The `displayRole` Property:**
This new property on `BaseMessage` serves two critical purposes:

1.  **UI Forwarding:** It tells adapters exactly what to show the user.
2.  **Long-Running Conversation View:** It tells the agent how to format its history array (e.g., treating a cron injection as a `user` prompt, or a router confirmation as an `agent` history item) when providing a view of a long-running conversation. Note: These messages are _not_ directly used to construct the literal API call to an LLM provider; they are for constructing a coherent continuous view of the session state across multiple real LLM interactions.

**Conversation Membership Logic:**

- **User Conversation View:** Users should see any `UserMessage`, as well as any message with `role: 'agent'` (`AgentReplyMessage`) or explicitly tagged with `displayRole: 'agent'` (like certain `SystemMessage` or `PolicyRequestMessage`).
- **Agent Conversation View:** Agents should see any `AgentReplyMessage` (their own replies), as well as any `UserMessage` or any message explicitly tagged with `displayRole: 'user'` (like system notifications or cron triggers). Internal tool messages/logs without a `displayRole` are also injected directly into the LLM context, but the `displayRole` governs the high-level semantic timeline.

The effective display role is derived as follows:

- **`UserMessage`**: Implicitly `user`
- **`AgentReplyMessage`**: Implicitly `agent`
- **`PolicyRequestMessage`**: Explicitly `displayRole: 'agent'`
- **`SystemMessage`**: Can be explicitly `displayRole: 'user'` (e.g., cron, subagent updates) or `displayRole: 'agent'` (e.g., router confirmations).
- **`ToolMessage`**: No `displayRole`
- **`CommandLogMessage` / `LogMessage`**: No `displayRole` (Hidden from the user UI by default, kept as internal tool context).

**Specific Logic for Adapters (e.g., `adapter-discord`):**
To prevent spam and provide a clean chat experience, adapter forwarder loops should implement a simplified 2-step check to determine if a message should be synced to the user:

1. **Does NOT have a `subagentId`:** Keep internal subagent chatter hidden from the main thread, unless the user has opted to view subagent threads. If enabled, the UI should show the subagent as a thread where the top-most message is the subagent ID, and clicking into it reveals the entire thread.
2. **Has an effective `displayRole` of `'agent'`:** Only forward messages meant for the user. `UserMessage` / `SystemMessage` inputs with `displayRole: 'user'` are skipped (to avoid echoing). Internal logs without a `displayRole` are skipped.

Messages that pass this check are forwarded. Special cases:

- **`policy`:** Should be rendered interactively (e.g., with "Approve" and "Reject" buttons).
- **Files/Attachments:** For any forwarded message that contains a `files` array, the adapter must resolve the paths relative to the workspace root and attach them, respecting platform upload limits.
- **Large Content:** Split content > 2000 characters into chunks if the platform requires it.

### 3.4. Backwards Compatibility & Migration Strategy

Because existing chat logs (`chat.jsonl`) heavily utilize the older, overloaded `UserMessage` and `CommandLogMessage` structures, the system must handle legacy data gracefully when loading historical chat sessions.

We will introduce a legacy-aware parsing step when reading chat history:

1. **Legacy `UserMessage` (`role: 'user'`)**
   - **Handling:** Maps directly to the new `UserMessage` interface. Because we previously injected system/cron events as `UserMessage`, these will continue to appear as regular user messages in historical logs. This is functionally safe and acceptable.

2. **Legacy `CommandLogMessage` (`role: 'log'`)**
   - **Handling:** The loader will detect all older `role: 'log'` messages and safely map them to the new `LegacyLogMessage` taxonomy (`role: 'legacy_log'`). We will not attempt fragile heuristics to split them into replies versus background logs.
   - **Fallback Rendering:** Adapters and UI layers must be prepared to accept `LegacyLogMessage` and gracefully degrade to rendering it as a generic, collapsed code block or text node, ensuring the UI does not crash or omit past information.

## 4. Privacy, Security, and Accessibility Concerns

- **Security/Policies:** The introduction of the `PolicyRequestMessage` heavily improves security UX, making pending policy requests visible and actionable within the primary chat interface.
- **Accessibility:** By providing distinct semantic types, screen readers and standard web components can better announce "System notification" versus "Agent reply", improving the overall accessible experience of the web UI.

## 5. Next Steps

1. Refactor `src/shared/chats.ts` to define the new interfaces.
2. Update `src/daemon/agent/chat-logger.ts` to expose methods for the new types (`logSystemMessage`, `logAgentReply`, `logToolMessage`, etc.).
3. Update routers (`slash-policies.ts`, `agent-router.ts`, etc.) to use the appropriate new log methods.
4. Add `clawmini-lite reply` and `clawmini-lite tool` commands.
5. Update frontends/adapters to parse and display the new types correctly.
