# Notes: lite-fetch-pending

## Core Concepts
1. **`clawmini-lite` CLI:** A standalone client located in `src/cli/lite.ts`. It communicates with the daemon via a TRPC client.
2. **Daemon Task Queue:** In `src/daemon/queue.ts`, the `Queue` class stores tasks in a `pending` array. It has an `extractPending()` method that removes all pending tasks from the queue and returns their string payloads. It clears them by rejecting their promises with "Task extracted for batching". Wait, if we use `extractPending()`, those tasks are effectively cancelled and will no longer be executed by the queue. This matches the feature requirement: "which should be removed from the daemon's task queue".
3. **Current Task Interruption:** The requirement states: "The current task should continue running uninterrupted." `extractPending()` only affects the `pending` array; it does not call `abortCurrent()`. This perfectly aligns with the requirement.
4. **Formatting:** The extracted messages should be batched together in `<message>` tags, similar to how `/interrupt` does it in `src/daemon/message.ts`. 
```typescript
const pendingText = payloads.map((text) => `<message>\n${text}\n</message>`).join('\n\n');
```
5. **TRPC Router:** We need to add a new mutation or query to `src/daemon/router.ts`. Let's call it `fetchPendingMessages`. It will take a `cwd` or use `process.cwd()` to find the correct queue using `getQueue(cwd)`. Note that `process.cwd()` in the daemon is the daemon's working directory. Actually, `logMessage` currently uses `process.cwd()` to get `cwd`, which is the workspace root where the daemon was started. Wait, in `src/daemon/router.ts`:
```typescript
fetchPendingMessages: apiProcedure
  .mutation(async ({ ctx }) => {
    const { getQueue } = await import('./queue.js');
    const queue = getQueue(process.cwd()); // Or pass cwd from input
    const extracted = queue.extractPending();
    if (extracted.length === 0) return null;
    return extracted.map((text) => `<message>\n${text}\n</message>`).join('\n\n');
  })
```
6. **CLI Command:** In `src/cli/lite.ts`, add a `messages pending` or `fetch-pending` command.
```typescript
program
  .command('fetch-pending')
  .description('Fetch all pending messages from the task queue and remove them')
  .action(async () => {
    const client = getClient();
    const result = await client.fetchPendingMessages.mutate();
    if (result) console.log(result);
  });
```

## Potential Issues
- `process.cwd()` in the daemon context refers to the directory the daemon was started in. If there are multiple chats/directories, the CLI might need to pass its `cwd` to ensure it fetches from the correct queue.
- Rejection of pending tasks: `queue.extractPending()` rejects the promises of the extracted tasks. This might cause unhandled rejection errors or log noise if the enqueuing side doesn't handle the `AbortError` gracefully. `src/daemon/message.ts` enqueues them and logs errors. We should verify if "Task extracted for batching" rejection causes unwanted behavior in `src/daemon/message.ts`.

## TRPC Input
We should probably allow passing `cwd` or `chatId` optionally, though the queue is keyed by `cwd`. In `src/daemon/message.ts`, `const queue = getQueue(cwd);` is used, where `cwd = state.cwd ?? process.cwd()`.

Let's check how `enqueue` rejection is handled in `src/daemon/message.ts`.

## Update: Session-Scoped Queue Operations
- **Requirement:** `/interrupt` and `fetch-pending` should ONLY affect messages for the current session. If other messages are in the same queue (which is per-folder) but different sessions, they should be unaffected. `/stop` should remain more powerful and affect the entire queue.
- **Queue Implementation:** The `Queue` class in `src/daemon/queue.ts` uses a generic `TPayload` which defaults to `string`. The queue's `extractPending` and `abortCurrent` methods currently apply to all items. We need to refactor `Queue` to support a filtering predicate, e.g., `extractPending(predicate)` and `abortCurrent(predicate)`.
- **Payload Structure:** In `src/daemon/message.ts`, `queue.enqueue` currently receives `state.message` (a string) as the payload. We need to change the payload to an object containing both the message text and the `sessionId`, e.g., `{ text: string; sessionId: string }`.
- **fetchPendingMessages TRPC Endpoint:** The `fetchPendingMessages` endpoint in `src/daemon/router.ts` needs to be updated to extract only messages matching the caller's session. The CLI client (`clawmini-lite`) authenticates via an API token that already includes the `sessionId` in its payload (`ctx.tokenPayload.sessionId`). The TRPC endpoint can read this and pass it to `extractPending`.
- **Interrupt Handler:** In `src/daemon/message.ts`, when `state.action === 'interrupt'`, we should use `state.sessionId` to only abort and extract the current session's tasks.