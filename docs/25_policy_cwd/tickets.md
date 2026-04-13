# Policy CWD & Output Tickets

## Ticket 1: Schema and Type Updates
**Status**: Complete

**Tasks:**
- Update `src/shared/config.ts` (`EnvironmentSchema`) to include an optional `baseDir` string property.
- Update `src/shared/policies.ts` (`PolicyRequest`) to include an optional `cwd` string property.
- Update `src/cli/lite.ts` to capture `process.cwd()` and include it when calling `createPolicyRequest.mutate(...)`.
- Update `src/daemon/api/agent-router.ts` (`createPolicyRequest` procedure) to accept the new `cwd` parameter.

**Verification:**
- Run `npm run validate` to ensure TypeScript compilation, linting, and formatting pass without errors.

## Ticket 2: Smart Output Handling & CLI Output
**Status**: Complete

**Tasks:**
- Write an E2E test using the `debug` agent template that creates two auto-approved policies: one generating < 500 characters of output, and one generating >= 500 characters. 
- Ensure the E2E test fails (Red phase).
- Update `executeRequest` (or the underlying execution logic in `src/daemon/policy-utils.ts`) to intercept `stdout` and `stderr`.
- If the output is < 500 chars, return it inline.
- If the output is >= 500 chars:
  - Write it to `./tmp/stdout-<id>.txt` (or stderr) inside the agent's host directory.
  - Return the summary string: `stdout is <length> characters, saved to ./tmp/stdout-<id>.txt`.
- Update `src/cli/lite.ts` to output the returned string or inline output to the terminal so the agent can read it.
- Ensure the E2E test passes (Green phase).

**Verification:**
- The new Smart Output E2E test passes.
- Run `npm run validate` to ensure all checks pass.

## Ticket 3: Path Translation Logic
**Status**: Complete

**Tasks:**
- Create a path translation helper function (e.g., in `src/daemon/api/router-utils.ts` or `src/daemon/policy-utils.ts`) that takes the sandbox `cwd`, environment `baseDir`, and host `agentDir`.
- Implement logic to strip `baseDir` from `cwd` and resolve the remainder against `agentDir`.
- Implement security validation to ensure the resulting path does not escape `agentDir` (prevent path traversal/directory escape).
- Write comprehensive unit tests for this translation helper, testing valid paths, undefined `baseDir`, and malicious escape attempts.

**Verification:**
- Run the new unit tests and ensure they pass.
- Run `npm run validate` to ensure all checks pass.

## Ticket 4: Context-Aware Execution Integration
**Status**: Complete

**Tasks:**
- Write an E2E test using the `debug` agent template where the agent navigates to a subdirectory (e.g., `cd foo`) and invokes a `pwd` policy.
- Ensure the E2E test fails (Red phase), as it will currently return the workspace root.
- Update `src/daemon/routers/slash-policies.ts` and the auto-approve logic to look up the active chat/agent's environment configuration.
- Use the path translation helper from Ticket 3 to determine the correct host `cwd` for the policy execution.
- Pass the translated host `cwd` into `executeRequest` instead of `getWorkspaceRoot()`.
- Ensure the E2E test passes (Green phase).

**Verification:**
- The new Context-Aware Execution E2E test passes.
- Run `npm run validate` to ensure all system checks pass.

## Ticket 5: DRY Violation for host cwd resolution
**Status**: Complete

**Tasks:**
- The logic to resolve the host working directory using `getActiveEnvironmentInfo`, `readEnvironment`, and `translateSandboxPath` is duplicated identically in `src/daemon/api/agent-policy-endpoints.ts` and `src/daemon/routers/slash-policies.ts`. Extract this into a reusable function in `src/daemon/policy-utils.ts`.

**Verification:**
- Run `npm run validate` to ensure all checks pass.

## Ticket 6: Leftover Debug Logs
**Status**: Complete

**Tasks:**
- `src/daemon/policy-utils.ts` contains `console.log` statements in `translateSandboxPath` that were likely meant for debugging and should be removed.

**Verification:**
- Run `npm run validate` to ensure all checks pass.
