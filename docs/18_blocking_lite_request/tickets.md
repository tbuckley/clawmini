# Implementation Tickets: Blocking Lite Request

## Ticket 1: Add `getPolicyRequest` to AgentRouter
**Description**: Add a new tRPC query procedure `getPolicyRequest` to `src/daemon/api/agent-router.ts`. The procedure should accept a request `id` (string) and return the current state of the request using `RequestStore.load(id)`.
**Status**: Complete
**Verification**:
- Add unit tests in `src/daemon/api/agent-router.test.ts` (if it exists) or `src/daemon/api/policy-request.test.ts` verifying that `getPolicyRequest` successfully retrieves an existing request and returns `null` for non-existent ones.
- Run `npm run validate` and ensure no lint or type errors are introduced.

## Ticket 2: Update CLI with `--no-wait` flag and Polling Loop
**Description**: Update `src/cli/lite.ts` command `request <cmd>` to block by default. Add the `--no-wait` flag. Implement a polling loop (using `getPolicyRequest`) that checks the request state every 2 seconds if `--no-wait` is not provided and the request is not auto-approved. Print a waiting indicator. Exit when the request state becomes `Approved` or `Rejected`, printing the execution result/reason and corresponding exit code.
**Status**: Complete
**Verification**:
- Add or update e2e tests (e.g. `src/cli/e2e/...`) to verify the CLI blocks and exits properly on approval or rejection.
- Test `--no-wait` flag to verify immediate exit behavior is preserved.
- Run `npm run validate` to ensure tests and type checks pass.

## Ticket 3: Refactor CLI execution result handling (DRY)
**Description**: In `src/cli/lite.ts`, the logic for printing `stdout`/`stderr` and exiting with `exitCode` from the `executionResult` is duplicated. Extract this logic into a helper function to avoid violating DRY principles.
**Status**: Complete
**Priority**: High

## Ticket 4: Modernize setTimeout usage
**Description**: In `src/cli/lite.ts`, replace `await new Promise((resolve) => setTimeout(resolve, 2000));` with `import { setTimeout } from 'timers/promises'` and `await setTimeout(2000);` for cleaner code.
**Status**: Complete
**Priority**: Low

## Ticket 5: Simplify boolean check
**Description**: In `src/cli/lite.ts`, change `if (options.wait === false)` to `if (!options.wait)` for clearer and more idiomatic boolean evaluation.
**Status**: Complete
**Priority**: Low