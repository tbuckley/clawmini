# Implementation Tickets: Process Interruptions

## Step 1: Update Queue Management
**Description:** Update the `Queue` class to support aborting the currently running task, clearing pending tasks, and retrieving pending tasks for batching.
**Tasks:**
- Modify `src/daemon/queue.ts` to track an `AbortController` for the currently executing task.
- Add a method `abortCurrent()` that triggers the `AbortController`.
- Add a method `clear()` or `clearQueue()` that removes all pending, non-executing tasks.
- Add a method to retrieve and remove pending tasks (e.g., `extractPending()`) to allow for batching.
- Update `src/daemon/queue.test.ts` to cover these new methods and ensure promises are handled correctly without unhandled rejections.
**Verification:**
- Run: `npm run format:check && npm run lint && npm run check && npm run test`
**Status:** Complete

## Step 2: Update Command Execution with AbortSignal
**Description:** Plumb the `AbortSignal` down to the actual process execution so that `child_process.spawn` can terminate the task.
**Tasks:**
- Locate where `runCommand` or `RunCommandFn` is defined and used (likely in `src/cli/client.ts`, `src/daemon/message.ts`, or similar).
- Update the signature to accept an `AbortSignal`.
- Pass the `signal` option to `child_process.spawn`.
- Ensure that the resulting promise resolves or rejects cleanly when aborted (catching `AbortError` or checking process termination signal).
- Add or update relevant unit tests to verify the abort behavior.
**Verification:**
- Run: `npm run format:check && npm run lint && npm run check && npm run test`
**Status:** Complete

## Step 3: Implement Interruption Routers
**Description:** Create slash command routers to detect `/stop` and `/interrupt` commands from the user and signal the intended action via the `RouterState`.
**Tasks:**
- Update the `RouterState` interface (e.g., in `src/daemon/routers.ts`) to include an `action: 'stop' | 'interrupt' | 'continue'` field or similar interrupt flag.
- Create a new router for `/stop` (e.g., `src/daemon/routers/slash-stop.ts`) that sets the action to 'stop' and provides an acknowledgment in the `reply` field.
- Create a new router for `/interrupt` (e.g., `src/daemon/routers/slash-interrupt.ts`) that sets the action to 'interrupt' and provides an acknowledgment.
- Update `src/daemon/routers/index.ts` to include the new routers in the pipeline.
- Write unit tests for the new routers in the appropriate `.test.ts` files.
**Verification:**
- Run: `npm run format:check && npm run lint && npm run check && npm run test`
**Status:** Complete

## Step 4: Integrate Interruptions in Message Handler
**Description:** Wire up the router states to the queue methods within the main message processing loop.
**Tasks:**
- Update the message handling logic in `src/daemon/message.ts` (e.g., `handleUserMessage` or `executeDirectMessage`).
- After router execution, check the `RouterState` for interruption commands.
- If `action === 'stop'`: call `queue.abortCurrent()` and `queue.clear()`. Do not enqueue a new task.
- If `action === 'interrupt'`: call `queue.abortCurrent()`, extract pending tasks via `queue.extractPending()`, concatenate their text payloads with the new user message, and enqueue the combined payload as a single new task.
- Ensure the system replies to the user with the router's acknowledgment message.
- Update tests in `src/daemon/message.test.ts` (or similar) to verify the end-to-end interruption flow.
**Verification:**
- Run: `npm run format:check && npm run lint && npm run check && npm run test`
**Status:** Complete

## Step 5: DRY Violation - Extract shared spawn logic
**Description:** The logic for `spawn` and wrapping it in a Promise for `runCommand` is duplicated in `src/daemon/cron.ts`, `src/daemon/router.ts`, and `src/daemon/message-test-utils.ts`. Extract it into a shared utility function.
**Tasks:**
- Create `src/daemon/utils/spawn.ts` or a suitable shared location.
- Extract the common `runCommand` Promise wrapper logic there.
- Update `cron.ts`, `router.ts`, and `message-test-utils.ts` to use this new utility.
- Ensure type definitions (`RunCommandFn` etc) are imported correctly.
**Status:** Complete
**Priority:** High

## Step 6: DRY Violation - Consolidate slash command routers
**Description:** `slash-stop.ts` and `slash-interrupt.ts` are almost identical. Refactor to use a shared factory or utility for creating these static action routers to follow DRY principles.
**Tasks:**
- Create a shared utility function in `src/daemon/routers/utils.ts` (or similar) that generates these basic slash command routers.
- Update `slash-stop.ts` and `slash-interrupt.ts` to use this utility.
- Verify tests still pass.
**Status:** Complete
**Priority:** Medium
