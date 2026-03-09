# Tickets: lite-fetch-pending

## Step 1: Add TRPC Endpoint `fetchPendingMessages`
- **Description**: Add the `fetchPendingMessages` mutation to `src/daemon/router.ts` that retrieves the queue, extracts pending messages, formats them in `<message>` tags, and returns them as a single string. Update `src/daemon/message.ts` to ensure `AbortError` is handled gracefully when tasks are extracted.
- **Verification**: Write a unit test to verify the TRPC mutation extracts and formats messages properly without aborting current tasks. Check `npm run format:check && npm run lint && npm run check && npm run test`.
- **Status**: Complete

## Step 2: Add `fetch-pending` Command to `clawmini-lite`
- **Description**: In `src/cli/lite.ts`, register a new `fetch-pending` command under the main program. This command should invoke the new TRPC mutation via `getClient().fetchPendingMessages.mutate()` and output the result to `stdout`.
- **Verification**: Write an E2E test in `src/cli/e2e/export-lite-func.test.ts` (or an appropriate test file) to verify that `clawmini-lite fetch-pending` outputs the expected batch of messages if there are any. Check `npm run format:check && npm run lint && npm run check && npm run test`.
- **Status**: Not started

## Step 3: Update System Prompt for `gemini-claw-cladding`
- **Description**: Update `templates/gemini-claw-cladding/.gemini/system.md` to inform the agent that additional user messages may be batched in `<message>` tags following tool calls.
- **Verification**: Ensure the updated system prompt text makes sense and matches the PRD requirements.
- **Status**: Not started