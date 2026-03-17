# Auto Approve Policy Issues

## High Priority
- [x] **Extract duplicate policy execution logic**: `agent-router.ts` and `slash-policies.ts` both implement the same logic to interpolate args, execute `executeSafe`, save the result, and construct/append a log message. Extract this into a shared utility function.
- [x] **Persist manual execution results**: In `slash-policies.ts`, `req.executionResult` is never populated or saved to the request store when a request is manually approved. This leaves the data incomplete compared to auto-approved requests.

## Medium Priority
- [x] **Avoid redundant disk writes**: When `autoApprove` is true, `createRequest` saves the request to the store, and immediately after `agent-router.ts` saves it again to attach `executionResult`. We should execute first or allow `createRequest` to accept `executionResult` and avoid saving twice.

## Low Priority
- [x] **Simplify `autoApprove` type (YAGNI)**: The `PolicyDefinition` interface defines `autoApprove` as `boolean | string`, but only its truthiness is checked. Simplify it to `boolean` to avoid confusion.