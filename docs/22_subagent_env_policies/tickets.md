# Subagent Environment Policies Tickets

## Ticket 1: Update PolicyDefinition Schema
**Description:** Update the `PolicyDefinition` schema to make the `command` field optional. This allows users to define a policy using a pseudo-command as the key in `policies.json` without needing to specify a `command` field explicitly.
**Verification:**
- Run `npm run validate` to ensure type-checks, tests, and linting pass.
- Verify the relevant type definitions allow `command` to be optional.
**Status:** complete

## Ticket 2: Environment Resolution Logic for Subagents
**Description:** Implement environment resolution for the source and target agents during `subagentSpawn` and `subagentSend`. Use the existing `getActiveEnvironmentName` utility. If environments match, proceed normally. If an environment resolves to `null`, represent it as `host` in the policy evaluation.
**Verification:**
- Add unit tests verifying the correct environment resolution and mapping.
- Run `npm run validate` to ensure all automated checks pass.
**Status:** complete

## Ticket 3: Policy Request Generation & Auto-Approval
**Description:** Intercept `subagentSpawn` and `subagentSend` when the source and target environments differ. Generate a `PolicyRequest` using the pseudo-command `@clawmini/subagent:<sourceEnv>:<targetEnv>`. Encapsulate the payload in `args` (e.g., `["spawn", targetAgentId, targetSubagentId, prompt]`). Integrate with `policies.json` auto-approval logic for these pseudo-commands.
**Verification:**
- Add unit tests for `PolicyRequest` generation and the auto-approval logic matching subagent pseudo-commands.
- Run `npm run validate`.
**Status:** complete

## Ticket 4: Synchronous Execution Flow (Blocking)
**Description:** Update `subagentSpawn` and `subagentSend` APIs to handle synchronous execution (`async: false`). If a policy request is generated, block the API call until it is approved or rejected. Throw a clear error (e.g., `TRPCError('FORBIDDEN')`) if rejected. If approved, commence execution and return the subagent ID.
**Verification:**
- Add integration/unit tests verifying the synchronous blocking behavior and error throwing.
- Run `npm run validate`.
**Status:** not started

## Ticket 5: Asynchronous Execution Flow
**Description:** Update `subagentSpawn` and `subagentSend` APIs for asynchronous execution (`async: true`). Queue the `PolicyRequest` and return the generated subagent ID immediately. Execute the subagent only after asynchronous approval. If rejected, transition the subagent status to `failed`.
**Verification:**
- Add integration/unit tests for asynchronous queuing, delayed execution, and correct status updates upon rejection.
- Run `npm run validate`.
**Status:** not started
