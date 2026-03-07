# Product Requirements Document: Process Interruptions

## 1. Vision
To enhance the Gemini CLI's responsiveness and user control by allowing users to seamlessly halt or interrupt long-running background tasks (agents). Users should be able to abandon a task entirely or interrupt it to inject new context/instructions without waiting for the current task to finish.

## 2. Product/Market Background
Currently, the CLI processes messages in a sequential queue per directory. Once a command starts via `child_process.spawn`, it runs to completion (or failure). If an agent goes down the wrong path or a user realizes they forgot a crucial detail, they cannot intervene until the agent finishes. Providing explicit `/stop` and `/interrupt` commands gives users back control over long-running LLM processes.

## 3. Use Cases
1.  **Runaway Agent:** A user asks an agent to "refactor the auth flow." The agent starts heavily modifying files incorrectly. The user quickly types `/stop` to kill the process and discard any queued follow-ups.
2.  **Course Correction:** A user tasks the agent with "implementing the login page." Mid-execution, the user realizes they forgot to mention using TailwindCSS. They type `/interrupt also ensure you use Tailwind CSS.` The current agent run is killed, and the new context is batched with any other pending queued messages into a single, comprehensive follow-up task.

## 4. Requirements

### 4.1 Functional Requirements
1.  **Slash Commands:**
    *   `/stop`: Kills the currently running task in the active queue and clears all other pending, unprocessed messages in that queue.
    *   `/interrupt [optional extra text]`: Kills the currently running task. Any text appended to the command is batched together with any other pending messages in the queue into a single, new message task.
2.  **Process Termination:**
    *   The system must send a termination signal (`SIGTERM`) to the underlying spawned process when an interruption is requested.
3.  **Queue Management:**
    *   The `Queue` (`src/daemon/queue.ts`) must support tracking the active task's `AbortController` and provide an interface to abort it.
    *   The `Queue` must support clearing its pending tasks (for the `/stop` command).
    *   The `Queue` must support batching pending tasks (for the `/interrupt` command).
4.  **Router Integration:**
    *   A new or existing router must parse `/stop` and `/interrupt` commands.
    *   The router must set a flag or action on the `RouterState` (e.g., `action: 'stop' | 'interrupt'`) so the main message handler knows to invoke the queue interruption logic.
    *   The router should provide a simple acknowledgment back to the user via the existing `reply` field on the `RouterState` (e.g., `reply: "[@clawmini/interrupt] Task interrupted."`).

### 4.2 Technical Implementation Details
*   **Daemon/Client Communication:** Update `runCommand` (and `RunCommandFn`) to accept and respect an `AbortSignal`. Pass this signal down to `spawn`.
*   **Message Processing (`src/daemon/message.ts`):** In `handleUserMessage` or `executeDirectMessage`, check the resulting `RouterState`. If it indicates an interruption:
    1.  Call the queue's abort method.
    2.  If `/stop`, clear the queue.
    3.  If `/interrupt`, fetch pending queue items, merge their message strings, append the new message string, and enqueue this combined payload as a single task.

### 4.3 Out of Scope
*   Handling complex fallback termination signals (e.g., escalating from `SIGTERM` to `SIGKILL` if the process hangs). We will start with standard `SIGTERM`.
*   Interrupting tasks that are purely synchronous/CPU-bound within the Node daemon itself (this primarily targets spawned child processes).

## 5. Security & Privacy
*   Process termination should only affect child processes spawned by the current workspace queue. It must not leak signals to sibling projects or the host daemon.
*   Path traversal and command injection risks remain unchanged, as the inputs are standard chat messages routed normally.

## 6. Accessibility
*   No new UI elements are required; the interface is purely text-based (slash commands) and relies on existing text rendering for router replies.
