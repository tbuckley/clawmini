# Auto Approve Policy Implementation Plan

## Ticket 1: Update Policy Schema
**Description:** Update the `PolicyDefinition` interface to support the new `autoApprove` configuration flag.
**Tasks:**
- Modify the `PolicyDefinition` interface (likely in `src/shared/policies.ts` or similar) to include an optional `autoApprove?: boolean | string` field.
- Ensure the configuration parser handles this new field properly, maintaining backwards compatibility (defaulting to false).
**Verification:**
- Run `npm run validate` to ensure type checks and linting pass.
**Status:** Not Started

## Ticket 2: Implement Auto-Approval Logic in Daemon
**Description:** Update the daemon's TRPC mutation (`createPolicyRequest`) to handle policies with the `autoApprove` flag enabled.
**Tasks:**
- In the `createPolicyRequest` logic (e.g., `src/daemon/api/agent-router.ts`), check if the requested policy has `autoApprove` set to a truthy value.
- If true:
  - Immediately execute the policy command using `executeSafe`.
  - Save the request with the `Approved` state instead of `Pending`.
  - Inject an audit message (debug level) into the chat history stating the policy was auto-approved and executed.
  - Return the execution results (stdout/stderr/exit code) directly in the TRPC response so the CLI can receive it.
- Ensure policies without `autoApprove` continue using the standard manual approval flow.
**Verification:**
- Add/update unit tests for `createPolicyRequest` to cover the auto-approve branch.
- Run `npm run validate` to ensure tests, linting, and type checks pass.
**Status:** Not Started

## Ticket 3: Update CLI for Synchronous Execution
**Description:** Update the CLI command `clawmini-lite request <cmd>` to handle synchronous responses from auto-approved policies.
**Tasks:**
- Modify the CLI command logic so that if the TRPC response contains execution results (because it was auto-approved), the CLI blocks until the response is received.
- Output the execution results (stdout/stderr) directly to the standard output streams of the CLI process.
- Return the appropriate exit code based on the execution result.
**Verification:**
- Add/update tests for the CLI `request` command to verify it handles synchronous responses and outputs them correctly.
- Run `npm run validate` to ensure tests, linting, and type checks pass.
**Status:** Not Started
