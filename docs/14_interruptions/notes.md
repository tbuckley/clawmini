# Interruptions Feature Notes

## Current Architecture

*   **Message Processing:** Handled in `src/daemon/message.ts`. It takes user input, runs it through routers to determine the active agent and format the command, and queues it up for execution.
*   **Execution Queue:** Managed in `src/daemon/queue.ts`. Currently, it's a simple Promise chain:
    ```typescript
    export class Queue {
      private queue: Promise<void> = Promise.resolve();
      enqueue(task: Task): Promise<void> {
        const next = this.queue.then(task).catch(() => {});
        this.queue = next;
        return next;
      }
    }
    ```
    This queue is per-directory. It does not currently have functionality to cancel running tasks or clear pending tasks.
*   **Command Execution:** `runCommand` (used by `executeDirectMessage`) runs via `child_process.spawn`. It doesn't currently accept an `AbortSignal`.
*   **Routers:** Located in `src/daemon/routers/` (e.g., `slash-command.ts`, `slash-new.ts`). They can mutate the `RouterState`, which determines the actual command and message sent to the agent.

## Implementation Requirements

1.  **AbortController Integration:**
    *   Update `RunCommandFn` and `runCommand` in `src/cli/client.ts` (or daemon runner) to accept an `AbortSignal`.
    *   Pass the signal to `child_process.spawn(..., { signal })` so the OS sends a kill signal (typically `SIGTERM` or `SIGKILL`) when aborted.
2.  **Queue Management:**
    *   Add the ability to track the currently running task's `AbortController` in the `Queue` class.
    *   Add a method to `Queue` (e.g., `abortCurrent()`) to trigger the abort.
    *   Potentially add a method to clear the queue if the user wants to cancel all pending messages (`/stop`).
3.  **Router Support:**
    *   Create or update routers to parse interruption commands (e.g., `/stop`, `/interrupt`).
    *   The router needs a way to signal back to the message handler that an interruption is requested *before* the message is queued.
    *   Update `executeRouterPipeline` or `RouterState` to include an `interrupt` flag or an `action: 'stop' | 'interrupt'` payload.
4.  **Message Handler Logic (`handleUserMessage` / `executeDirectMessage`):**
    *   Before queueing the new message, check if the `RouterState` requested an interruption.
    *   If yes, call the queue's abort method.
    *   Send an automatic reply (log message) to the chat confirming the abortion or interruption.
    *   Queue the new message (if not just `/stop`).
