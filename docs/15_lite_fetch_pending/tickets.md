# Tickets: lite-fetch-pending

## Step 1: Add TRPC Endpoint `fetchPendingMessages`
- **Description**: Add the `fetchPendingMessages` mutation to `src/daemon/router.ts` that retrieves the queue, extracts pending messages, formats them in `<message>` tags, and returns them as a single string. Update `src/daemon/message.ts` to ensure `AbortError` is handled gracefully when tasks are extracted.
- **Verification**: Write a unit test to verify the TRPC mutation extracts and formats messages properly without aborting current tasks. Check `npm run format:check && npm run lint && npm run check && npm run test`.
- **Status**: Complete

## Step 2: Add `fetch-pending` Command to `clawmini-lite`
- **Description**: In `src/cli/lite.ts`, register a new `fetch-pending` command under the main program. This command should invoke the new TRPC mutation via `getClient().fetchPendingMessages.mutate()` and output the result to `stdout`.
- **Verification**: Write an E2E test in `src/cli/e2e/export-lite-func.test.ts` (or an appropriate test file) to verify that `clawmini-lite fetch-pending` outputs the expected batch of messages if there are any. Check `npm run format:check && npm run lint && npm run check && npm run test`.
- **Status**: Complete

## Step 3: Update System Prompt for `gemini-claw-cladding`
- **Description**: Update `templates/gemini-claw-cladding/.gemini/system.md` to inform the agent that additional user messages may be batched in `<message>` tags following tool calls.
- **Verification**: Ensure the updated system prompt text makes sense and matches the PRD requirements.
- **Status**: Complete

## Step 4: Refactor and Cleanup (Code Review)
- **Description**:
  1. **High - DRY Violation**: `<message>\n${text}\n</message>` formatting logic is duplicated in `src/daemon/message.ts` and `src/daemon/router.ts`. Extract this logic into a shared helper function `formatPendingMessages` in `src/daemon/message.ts` and use it in both places.
  2. **Medium - Dynamic Imports**: Unnecessary dynamic import of `./queue.js` inside `fetchPendingMessages` in `src/daemon/router.ts` and in `beforeEach` in `src/daemon/router.test.ts`. Change these to static imports at the top of the files.
  3. **Low - Empty Catch Block**: The catch block handling `AbortError` in `src/daemon/message.ts` (`if (err instanceof Error && err.name === 'AbortError') { ... } else { throw err; }`) should be simplified to `if (!(err instanceof Error && err.name === 'AbortError')) throw err;`.
- **Verification**: Ensure all checks pass (`npm run format:check && npm run lint && npm run check && npm run test`).
- **Status**: Complete