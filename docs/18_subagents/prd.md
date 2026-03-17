# PRD: Subagents Feature

## 1. Vision
To enhance the multi-tasking and parallel processing capabilities of Gemini CLI agents by allowing them to spawn "subagents." A subagent can perform intensive, long-running tasks (e.g., triaging an email inbox, analyzing a large codebase, running tests) in the background without blocking the main chat or consuming the main agent's context tokens. This empowers the primary agent to act as an orchestrator, delegating work and staying responsive to the user.

## 2. Product/Market Background
Currently, agents operate sequentially in a single chat. If an agent starts a long-running process or needs to analyze a significant amount of data, it blocks the main chat loop. This leads to a poor user experience, as the user must wait for the task to finish before interacting with the agent again. Moreover, long-running or verbose tasks consume the context window of the main session. Introducing subagents solves this by isolating these tasks into separate chat contexts, running concurrently.

## 3. Use Cases
- **Email Triage:** The main agent spawns a subagent to read unread emails, categorize them, and summarize them, while the user continues to ask the main agent other questions.
- **Codebase Research:** The main agent spawns a subagent to find all references to a deprecated API and formulate a refactoring plan.
- **Test Fixing:** When a test suite fails, a subagent is spawned to iteratively fix tests, compile, and run them until they pass, while the main agent reports the status back to the user.

## 4. Requirements

### 4.1 CLI Commands (`clawmini-lite subagents`)
The new feature introduces a `subagents` command to `clawmini-lite` with the following subcommands:
- `add <message> [--agent <name>]`: Spawns a new subagent to handle the specified `message`. Defaults to the current agent if `--agent` is not provided. Returns the UUID of the newly created subagent.
- `list`: Shows all running and completed subagents for the current chat. Output should include the subagent ID, agent name, status (running/completed), creation time, and a snippet of the original message.
- `tail <id>`: Displays recent messages and logs for the specified subagent's chat.
- `send <id> <message>`: Appends a new message/directive to the running subagent.
- `stop <id>`: Interrupts and stops anything the subagent is currently executing (aborting its process queue).
- `delete <id>`: Stops the subagent (if running) and deletes its associated chat and files.

### 4.2 Architecture and Execution Bypassing Routers
- Messages sent to subagents should **not** go through the standard router pipeline (`executeRouterPipeline`). They should directly invoke `executeDirectMessage` to prevent router side-effects meant for main user interactions.
- Each subagent will have its own message queue (or execution context) independent of the main chat, allowing for true concurrent execution.

### 4.3 Chat Storage and ID Format
- **ID Format:** Subagent IDs within the system will be formatted as `{parentChatId}:subagents:{subagentUuid}`.
- **File System Structure:** The chat data will be stored physically at `chats/{parentChatId}/subagents/{subagentUuid}/chat.jsonl`.
- `isValidChatId` logic or related chat resolution logic must be updated to handle this namespaced ID scheme correctly.

### 4.4 Completion Notification
- When a subagent completes its task queue (i.e., when its execution process successfully finishes or errors out), it must automatically send a notification message back to the **parent chat**.
- **Message Format Proposal:**
  ```
  [Automatic message] Sub-agent {id} ({agent-name}) has completed its task.

  ### Original Request
  {original_message_snippet}

  ### Final Output
  {final_output_or_summary}
  ```
  *(Note: `{final_output_or_summary}` should be the result of the last command, or an error if it failed.)*

### 4.5 Parent Chat Lifecycle Hooks
- **Cascade Deletion:** If a parent chat is deleted via `clawmini chats delete <id>`, any associated running subagents must be immediately aborted, and their directories (`chats/{id}/subagents/*`) completely removed.

## 5. Security, Privacy & Accessibility Concerns
- **Security:** Ensure that `subagentDelete` and chat path resolution do not allow directory traversal. The strict format of `{chatId}:subagents:{subagentUuid}` must be validated safely.
- **Tokens/Performance:** Subagents inherently use API tokens and background processes. There may need to be a limit on the maximum number of concurrent subagents per parent chat or system-wide to prevent resource exhaustion.
- **Visibility:** Since subagents run in the background, users must be able to discover them (via `subagents list` or UI indicators in the future) so they are not surprised by hidden background token usage.