# Tickets for Agent Fallbacks

## Ticket 1: Configuration Schema and Type Updates
**Status:** completed

### Task
Update `src/shared/config.ts` to include the `fallbacks` property in `AgentSchema`.
- Create `FallbackSchema` with optional:
  - `commands`: Partial override for `new`, `append`, `getSessionId`, and `getMessageContent`.
  - `env`: `z.record(z.string(), z.string())` for environment overrides.
  - `retries`: `z.number().int().min(0)` (default 1).
  - `delayMs`: `z.number().int().min(0)` (default 1000).
- Update `AgentSchema` to include an optional `fallbacks: z.array(FallbackSchema)`.
- Update `Agent` type.

### Verification
- Run `npm run check` to ensure type consistency.
- Follow `./docs/CHECKS.md`: `npm run format:check && npm run lint`.
- (Optional) Verify with a small script that `AgentSchema.parse` handles a sample agent with multiple fallbacks.

---

## Ticket 2: Refactor Execution Loop and Error Detection
**Status:** completed

### Task
Refactor `executeDirectMessage` in `src/daemon/message.ts` to support a retry loop and implement failure detection.
- **Failure Detection**: A run is failed if:
  1. `mainResult.exitCode !== 0`
  2. OR `getMessageContent` returns an empty string (`result.trim() === ''`).
- **Loop Structure**:
  - Wrap the inner queue task logic in a loop that iterates through:
    1. Base configuration (first attempt).
    2. Each entry in `agent.fallbacks`.
  - For each fallback, support multiple attempts based on its `retries` count.
- Update `prepareCommandAndEnv` (or implement a new helper) to handle merging of the base agent with fallback overrides (`commands` and `env`).

### Verification
- Run existing tests `npm run test` to ensure no regressions.
- Add unit tests in `src/daemon/message-fallbacks.test.ts` mocking `runCommand` to fail once and then succeed, verifying the loop triggers.
- Follow `./docs/CHECKS.md`.

---

## Ticket 3: Exponential Backoff Logic
**Status:** completed

### Task
Implement the exponential backoff timing logic within the retry loop.
- **Delay Calculation**: `delay = delayMs * (2 ^ (attempt - 1))`.
- **Constraint**: Cap maximum delay at 15,000ms.
- **Implementation**: Use a `Promise`-based delay/sleep function before re-executing a command.
- Ensure the base `delayMs` defaults to 1000 if not provided in the fallback.

### Verification
- Add unit tests for the delay calculation logic to ensure it doubles correctly and caps at 15s.
- Follow `./docs/CHECKS.md`.

---

## Ticket 4: UX Retry Notifications
**Status:** completed

### Task
Integrate log messages for retries into the execution loop in `src/daemon/message.ts`.
- Before waiting for a retry delay, append a "log" message to the chat: `"Error running agent, retrying in <N> seconds..."`.
- Ensure the message is appended and persisted so the user can see the progress.
- Ensure the final successful (or final failed) output replaces or follows these retry logs correctly in the UI.

### Verification
- Run E2E or manual tests to confirm the "retrying in..." message appears in the `messages.json` of the chat during a failure.
- Follow `./docs/CHECKS.md`.

---

## Ticket 5: Comprehensive E2E Validation
**Status:** completed

### Task
Add E2E tests in `src/cli/e2e/messages.test.ts` to verify all fallback scenarios.
- **Scenario 1**: Base fails (exit code), fallback with env override succeeds.
- **Scenario 2**: Base succeeds but `getMessageContent` is empty, fallback with modified command succeeds.
- **Scenario 3**: Multiple retries for a single fallback (exponential backoff check).
- **Scenario 4**: All fallbacks exhausted, final failure reported.

### Verification
- Run `npm run test` and ensure all E2E tests pass.
- Final check of `./docs/CHECKS.md`.
