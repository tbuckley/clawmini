# Notes on Blocking Lite Request

## Current Behavior
- `clawmini-lite.js request <cmd>` submits a policy request via `AgentRouter.createPolicyRequest`.
- If the policy has `autoApprove: true`, the daemon executes the policy and includes `executionResult` in the response. The CLI prints `stdout`/`stderr` and exits with the executed `exitCode`.
- If the policy requires manual approval, `createPolicyRequest` returns immediately with a `Pending` state and no `executionResult`. The CLI prints "Request created successfully. Request ID: ..." and exits with code 0.

## Desired Behavior
- The `request` command should block by default, awaiting human approval or rejection.
- A new flag `--no-wait` should be introduced to preserve the current non-blocking behavior.

## Implementation Details
1. **Daemon Changes**:
   - The CLI communicates with the Daemon via `AgentRouter` (tRPC).
   - Currently, there is no endpoint on `AgentRouter` to fetch the status of an existing `PolicyRequest`.
   - We need to add a new `getPolicyRequest` (or `getPolicyRequestStatus`) procedure to `AgentRouter` that accepts a request `id` and returns the `PolicyRequest` (using `RequestStore.load(id)`).

2. **CLI Changes**:
   - Add `.option('--no-wait', 'Do not block and return immediately after creating the request')` to the `request` command.
   - If `--no-wait` is not set, implement a polling loop after `createPolicyRequest` returns a `Pending` state.
   - Polling loop will repeatedly call `getPolicyRequestStatus` (e.g., every 2 seconds).
   - Exit conditions for polling:
     - `state === 'Approved'`: Print `executionResult` (if available via state/result endpoint) and exit with the appropriate status code.
     - `state === 'Rejected'`: Print rejection reason and exit with a non-zero code (e.g., 1).
   - If `--no-wait` is set, maintain the current behavior of returning the Request ID and exiting immediately.

## Data Structures
- `PolicyRequest` interface in `src/shared/policies.ts`:
  - `state`: `'Pending' | 'Approved' | 'Rejected'`
  - `executionResult`: `{ stdout, stderr, exitCode }`
  - `rejectionReason`: Optional string.
