# Development Log - Agent Fallbacks

## 2026-03-03

- Initializing development log.
- Starting on Ticket 1: Configuration Schema and Type Updates.
- Discovered pre-existing test failure in `src/cli/e2e/messages.test.ts` (`should maintain atomic ordering of user and log messages with --no-wait`). Proceeding with Ticket 1 as it is unrelated to this failure.
- Updated `src/shared/config.ts` with `FallbackSchema` and `fallbacks` in `AgentSchema`.
- Verified schema with a temporary unit test.
- Ticket 1 complete.

- Refactored `src/daemon/message.ts`:
  - Updated `prepareCommandAndEnv` to merge base agent with fallback overrides.
  - Refactored `executeDirectMessage` to include a nested retry loop (base attempt + fallback attempts).
  - Implemented failure detection (non-zero exit code or empty extracted message content).
- Added `src/daemon/message-fallbacks.test.ts` with unit tests covering base failures, empty extraction, and multiple retries.
- Verified all checks and tests pass (including pre-existing flakiness in E2E tests which resolved themselves).
- Ticket 2 complete.

- Implemented exponential backoff logic in `src/daemon/message.ts`:
  - Added `calculateDelay` helper with doubling logic and 15s cap.
  - Added `sleep` helper.
  - Integrated backoff into the retry loop in `executeDirectMessage`.
- Added unit tests for `calculateDelay` in `src/daemon/message-fallbacks.test.ts`.
- Verified all checks and tests pass.
- Ticket 3 complete.

## 2026-03-03 (continued)

- Starting on Ticket 4: UX Retry Notifications.
- Identifying insertion point in `src/daemon/message.ts` for retry log messages.
- Implemented `retry-delay` log message in `executeDirectMessage`.
- Added unit test in `src/daemon/message-fallbacks.test.ts` to verify the log message is appended before the sleep delay.
- Verified all checks and tests pass.
- Ticket 4 complete.

- Starting on Ticket 5: Comprehensive E2E Validation.
- Planning E2E test cases for various fallback scenarios:
  - Base fails (exit code), fallback succeeds via env override.
  - Base fails (empty content), fallback succeeds via command override.
  - Exponential backoff (checking log messages).
  - Exhausted fallbacks (all fail).
- Implemented Ticket 5:
  - Discovered that "retrying" log messages were not appearing when moving between execution configurations (base -> fallback).
  - Updated `calculateDelay` in `src/daemon/message.ts` to support an `isFallback` flag, ensuring a delay (and thus a log message) is triggered when starting a fallback if `delayMs` is present.
  - Fixed `logMsg` construction to always include `stdout` property, as per `CommandLogMessage` definition and `napkin.md` notes.
  - Created `src/cli/e2e/fallbacks.test.ts` to house all fallback-related E2E tests, keeping `src/cli/e2e/messages.test.ts` within the `max-lines` limit.
  - Updated existing E2E test `should handle full multi-message session workflow` to expect `stdout` in log messages.
  - Verified all checks (`npm run format:check && npm run lint && npm run check && npm run test`) pass.
- Ticket 5 complete.

ALL DONE
