# E2E Test Improvements Tickets (Part 2)

## Step 1: Migrate Remaining Tests to the New API
- **Description**: Systematically refactor all remaining existing E2E tests to use the `TestEnvironment` API and the new SSE-based event waiting mechanism. Remove all manual file read/write polling.
- **Verification**:
  - Ensure the full E2E test suite passes reliably.
  - Run `npm run validate`.
- **Status**: not started

## Step 2: Implement Shared Daemon Architecture
- **Description**: Transition the E2E suite to use a shared daemon model. The daemon should be spun up during Vitest's `globalSetup` (or a shared hook), binding to `port: 0` to prevent collisions. Ensure tests leverage the `TestEnvironment`'s unique namespaces to avoid state leakage.
- **Verification**:
  - Run the entire test suite and verify a significant reduction in overall execution time. Check that tests pass without `EADDRINUSE` errors.
  - Run `npm run validate`.
- **Status**: not started

## Step 3: Simplified Subagent Mocking
- **Description**: Remove manual subagent shell-script scaffolding from tests. Introduce a configuration toggle (e.g., `enableSubagentEnvironment()`) in the test fixture to automatically inject `clawmini-lite.js` into the test agent's `$PATH` via the new built-in feature.
- **Verification**:
  - Verify that tests involving subagents still pass with the new streamlined setup.
  - Run `npm run validate`.
- **Status**: not started
