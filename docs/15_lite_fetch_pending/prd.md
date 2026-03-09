# Product Requirements Document: lite-fetch-pending

## Vision
Enhance the responsiveness and flexibility of the `clawmini-lite` CLI client by allowing external scripts and agents to retrieve and clear pending messages from the task queue. This feature enables agents to dynamically adjust their workflows by pulling in new context without interrupting their current execution context. Queue operations like `fetch-pending` and `/interrupt` should be safely scoped to the active session.

## Product / Market Background
In rapid messaging environments or high-throughput automated workflows, users or external systems may queue up multiple messages while the AI agent is still busy processing an initial complex task. Currently, the agent can only process these messages sequentially after finishing its current task, or it relies on `/interrupt` to halt what it's doing completely.

By allowing an agent (e.g., executing a local script) to actively query and retrieve pending messages, the agent can course-correct sooner by incorporating new user instructions or data directly into its active thinking process, making it significantly more intelligent and responsive.

Additionally, as the queue manages tasks across an entire directory/workspace, it is crucial that non-destructive interruptions like `/interrupt` and `fetch-pending` only modify tasks associated with the user's *current session*. A broader `/stop` command remains the primary way to halt the entire queue.

## Use Cases
1. **Adaptive Agent Workflows:** An agent is writing a large code refactor. Halfway through, it runs a command or pauses to fetch intermediate results. During this pause, it calls `clawmini-lite fetch-pending` to see if the user has added any new instructions or constraints since the task started. It receives the batched messages and adjusts the refactor accordingly without dropping its current task state.
2. **Task Queue Management:** A user scripting a workflow wants to clear out all pending tasks programmatically and handle them manually in a custom CLI tool.
3. **Session-Safe Interruptions:** A user has multiple long-running agents in the same workspace across different sessions. The user runs `/interrupt` in one chat session; this halts and extracts only the tasks in that specific session, leaving the other running agents unaffected.

## Requirements

### Functional Requirements
1. **CLI Command:** Implement a new command in `clawmini-lite` (`src/cli/lite.ts`), e.g., `clawmini-lite fetch-pending`.
2. **Daemon TRPC Endpoint:** Expose a new mutation or query (e.g., `fetchPendingMessages`) in `src/daemon/router.ts`.
3. **Queue Extraction (Session Scoped):** The daemon endpoint must utilize `Queue.extractPending()` to remove pending messages. This extraction MUST be filtered to only affect messages whose `sessionId` matches the session requesting the fetch.
4. **Non-Interrupting:** The current running task MUST NOT be aborted during `fetch-pending`. (This is already the native behavior of `extractPending()`).
5. **Interrupt Scoping:** The `/interrupt` command logic must be updated so it ONLY aborts and extracts tasks that belong to the current session ID. `/stop` must continue to abort and clear the entire queue globally.
6. **Formatting:** The extracted pending messages must be formatted and concatenated into a single string using `<message>` tags, maintaining consistency with how the `/interrupt` handler batches messages.
7. **Return Value:** If there are pending messages, the command should output the formatted string to `stdout`. If there are no pending messages, it should exit cleanly without output (or output an empty string) so it integrates seamlessly into shell scripts.
8. **System Prompt Update:** Ensure `templates/gemini-claw-cladding/.gemini/system.md` mentions that additional messages from the user may be batched together in `<message>` tags after tool calls.

### Technical Details & Adjustments
- **Queue Refactor:** The `Queue` class (`src/daemon/queue.ts`) must support predicate functions for `extractPending(predicate)` and `abortCurrent(predicate)`.
- **Payload Structure:** Tasks enqueued in `src/daemon/message.ts` must use an object payload containing both the message text and the `sessionId` (e.g., `{ text: string, sessionId: string }`) rather than a raw string.
- **TRPC Implementation:** The `fetchPendingMessages` endpoint will resolve the `chatId` and `cwd` from the request context. It must also extract the `sessionId` from `ctx.tokenPayload.sessionId` to properly filter the queue extraction.
- **Handling `AbortError`:** When `extractPending()` clears the queue, it rejects the pending tasks with an `AbortError`. Ensure that `src/daemon/message.ts` swallows `AbortError` gracefully even when `noWait` is false, preventing unnecessary CLI stack traces when messages are extracted by an agent.

## Security, Privacy, and Accessibility
- **Security:** Access to the `fetch-pending` command requires a valid `CLAW_API_TOKEN`. The daemon ensures that only requests authorized for the current chat or workspace can access its queue.
- **Privacy:** Pending messages are strictly scoped to the workspace's queue, preventing cross-workspace data leakage. The new session-scoping ensures privacy *between* sessions within the same workspace.
- **Accessibility:** Ensure the CLI command output is plain text and easily readable by screen readers or redirectable to other terminal tools.