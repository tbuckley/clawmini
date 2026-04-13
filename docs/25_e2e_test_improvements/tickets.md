# E2E Test Improvements Tickets (Part 1)

## Step 1: Implement the Unified Test Environment API
- **Description**: Create a high-level `TestEnvironment` or `TestFixture` class that abstracts the setup of E2E tests. It should provide methods to configure the workspace using standard CLI commands (e.g., `clawmini agents add`, `clawmini chats add`) and fallback to file edits where necessary. It should handle generating unique namespaces/IDs for isolated testing.
- **Verification**: 
  - Write unit tests for the new `TestEnvironment` class to verify its setup logic.
  - Run `npm run validate`.
- **Status**: not started

## Step 2: Implement Event-Driven State Verification (SSE)
- **Description**: Extend the `TestEnvironment` class to connect an SSE client to the daemon's existing endpoint. Buffer incoming events and implement fluent assertion/waiter functions (e.g., `waitForMessage(predicate)`) to replace filesystem polling.
- **Verification**:
  - Test the SSE client integration against a running daemon manually or via unit tests.
  - Run `npm run validate`.
- **Status**: not started

## Step 3: Migrate a Single Test to the New API
- **Description**: Refactor one specific E2E test file (e.g., `src/cli/e2e/messages.test.ts`) to use the `TestEnvironment` API and the new SSE-based event waiting mechanism. Remove all manual file read/write polling from this specific test.
- **Verification**:
  - Ensure the migrated E2E test passes reliably.
  - Run `npm run validate`.
- **Status**: not started
