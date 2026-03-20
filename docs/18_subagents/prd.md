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

### 4.1 Agent vs Subagent Capabilities
- **Jobs:** An agent can schedule tasks for itself using `clawmini-lite.js jobs`. A sub-agent cannot schedule jobs and should receive an error.
- **Logging:** An agent can send messages to the user via `clawmini-lite.js log`. A sub-agent cannot send messages to the user directly and should receive an error.
- **Asynchronous Execution:**
  - **Main Agent:** Never blocks on requests. Commands like `clawmini-lite.js subagents add` and `clawmini-lite.js request` always return immediately with an ID for the operation and completion notifications. The `--async` flag has no effect since these commands are always asynchronous for the main agent. Any `wait` command (`tasks wait`, `subagents wait`, `request wait`) should return an error if called by a main agent, as they must never block.
  - **Sub-Agent:** Defaults to blocking when calling these commands. A sub-agent may specify `--async` for these commands to receive an ID for the operation and run it asynchronously, but it must eventually block on these operations via a wait command (e.g., `clawmini-lite.js tasks wait <id>`).

### 4.2 CLI Commands (`clawmini-lite`)
- **`subagents`** subcommands:
  - `add <message> [--agent <name>] [--async]`: Spawns a new subagent to handle the specified `message`. Defaults to the current agent if `--agent` is not provided. Sync/async execution depends on the caller.
  - `list`: Shows all running and completed subagents for the current chat. Output should include the subagent ID, agent name, status (running/completed), creation time, and a snippet of the original message.
  - `tail <id>`: Displays recent messages and logs for the specified subagent's chat.
  - `send <id> <message>`: Appends a new message/directive to the running subagent.
  - `stop <id>`: Interrupts and stops anything the subagent is currently executing (aborting its process queue).
  - `delete <id>`: Stops the subagent (if running) and deletes its associated chat and files.
  - `wait <id>`: Alias for `tasks wait <id>`. Blocks the current sub-agent until the specified asynchronous subagent task completes.
- **`request`** subcommand additions:
  - `wait <id>`: Alias for `tasks wait <id>`. Blocks the current sub-agent until the specified asynchronous policy request task completes.
- **`tasks`** subcommands (used by subagents):
  - `pending`: Returns any tasks (policy requests or subagents) that have not yet been awaited by the subagent.
  - `wait <id>`: Blocks the current sub-agent until the specified asynchronous task (subagent or policy request) completes.

### 4.3 Architecture and Execution Bypassing Routers
- Messages sent to subagents should **not** go through the standard router pipeline (`executeRouterPipeline`). They should directly invoke `executeDirectMessage` to prevent router side-effects meant for main user interactions.
- Each subagent will have its own message queue (or execution context) independent of the main chat, allowing for true concurrent execution.

### 4.4 Chat Storage and ID Format
- **ID Format:** Subagent IDs within the system will be formatted as `{parentChatId}:subagents:{subagentUuid}`.
- **File System Structure:** The chat data will be stored physically at `chats/{parentChatId}/subagents/{subagentUuid}/chat.jsonl`.
- `isValidChatId` logic or related chat resolution logic must be updated to handle this namespaced ID scheme correctly.

### 4.5 Completion Notification, Await Enforcement & Lifecycle
- **Completion Notifications:** When a subagent completes its task queue, it must automatically send a notification message back to the **parent chat**.
- **Hook Enforcement:** A hook will watch if the subagent is attempting to stop working without having awaited some asynchronous operations (e.g. policy requests or subagents). It will force the subagent to continue, reminding it that it must await those tasks. For Gemini CLI, the `AfterAgent` hook allows us to force the agent to continue by responding with the JSON `{decision: "deny", reason: "must await ongoing tasks using 'clawmini-lite tasks pending' and 'tasks wait'..."}`.
- **Daemon Restarts / Persistence:** Unawaited tasks inside a subagent do not need to survive daemon restarts. If the daemon restarts, subagents should be considered killed, and a failure notification should be sent to the main agent's chat, allowing the main agent to decide whether to respawn it.

### 4.6 Parent Chat Lifecycle Hooks
- **Cascade Deletion:** If a parent chat is deleted via `clawmini chats delete <id>`, any associated running subagents must be immediately aborted, and their directories (`chats/{id}/subagents/*`) completely removed.

## 5. Security, Privacy & Accessibility Concerns
- **Security:** Ensure that `subagentDelete` and chat path resolution do not allow directory traversal. The strict format of `{chatId}:subagents:{subagentUuid}` must be validated safely.
- **Tokens/Performance:** Subagents inherently use API tokens and background processes. There may need to be a limit on the maximum number of concurrent subagents per parent chat or system-wide to prevent resource exhaustion.
- **Visibility:** Since subagents run in the background, users must be able to discover them (via `subagents list` or UI indicators in the future) so they are not surprised by hidden background token usage.