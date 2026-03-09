# Product Requirements Document: lite-fetch-pending

## Vision
Enhance the responsiveness and flexibility of the `clawmini-lite` CLI client by allowing external scripts and agents to retrieve and clear pending messages from the task queue. This feature enables agents to dynamically adjust their workflows by pulling in new context without interrupting their current execution context.

## Product / Market Background
In rapid messaging environments or high-throughput automated workflows, users or external systems may queue up multiple messages while the AI agent is still busy processing an initial complex task. Currently, the agent can only process these messages sequentially after finishing its current task, or it relies on `/interrupt` to halt what it's doing completely.

By allowing an agent (e.g., executing a local script) to actively query and retrieve pending messages, the agent can course-correct sooner by incorporating new user instructions or data directly into its active thinking process, making it significantly more intelligent and responsive.

## Use Cases
1. **Adaptive Agent Workflows:** An agent is writing a large code refactor. Halfway through, it runs a command or pauses to fetch intermediate results. During this pause, it calls `clawmini-lite fetch-pending` to see if the user has added any new instructions or constraints since the task started. It receives the batched messages and adjusts the refactor accordingly without dropping its current task state.
2. **Task Queue Management:** A user scripting a workflow wants to clear out all pending tasks programmatically and handle them manually in a custom CLI tool.

## Requirements

### Functional Requirements
1. **CLI Command:** Implement a new command in `clawmini-lite` (`src/cli/lite.ts`), e.g., `clawmini-lite fetch-pending`.
2. **Daemon TRPC Endpoint:** Expose a new mutation or query (e.g., `fetchPendingMessages`) in `src/daemon/router.ts`.
3. **Queue Extraction:** The daemon endpoint must utilize the existing `Queue.extractPending()` method in `src/daemon/queue.ts` to remove pending messages from the queue and retrieve their payloads.
4. **Non-Interrupting:** The current running task MUST NOT be aborted. (This is already the native behavior of `extractPending()`).
5. **Formatting:** The extracted pending messages must be formatted and concatenated into a single string using `<message>` tags, maintaining consistency with how the `/interrupt` handler batches messages. Example:
   ```xml
   <message>
   Message 1
   </message>

   <message>
   Message 2
   </message>
   ```
6. **Return Value:** If there are pending messages, the command should output the formatted string to `stdout`. If there are no pending messages, it should exit cleanly without output (or output an empty string) so it integrates seamlessly into shell scripts.
7. **System Prompt Update:** Ensure `templates/gemini-claw-cladding/.gemini/system.md` mentions that additional messages from the user may be batched together in `<message>` tags after tool calls. This trains the agent to handle dynamically injected user constraints correctly.

### Technical Details & Adjustments
- **TRPC Implementation:** The `fetchPendingMessages` endpoint should resolve the `chatId` and `cwd` from the request context. It will then fetch the queue associated with `cwd` (via `getQueue(cwd)`), extract the pending payloads, and return the formatted string.
- **Handling `AbortError`:** When `extractPending()` clears the queue, it rejects the pending tasks with an `AbortError`. If a client sent a message and is awaiting its completion (i.e., `noWait` was false), this rejection might cause the client's request to fail with an error. We may need to ensure that `src/daemon/message.ts` swallows `AbortError` gracefully even when `noWait` is false, preventing unnecessary CLI stack traces when messages are extracted by an agent.

## Security, Privacy, and Accessibility
- **Security:** Access to the `fetch-pending` command requires a valid `CLAW_API_TOKEN`, inheriting the existing security model of `clawmini-lite`. The daemon ensures that only requests authorized for the current chat or workspace can access its queue.
- **Privacy:** Pending messages are strictly scoped to the workspace's queue, preventing cross-workspace data leakage.
- **Accessibility:** Ensure the CLI command output is plain text and easily readable by screen readers or redirectable to other terminal tools.