# Tickets: Custom Token Environment Variables

## Step 1: Update Agent Schema
**Status**: Completed

**Tasks:**
- Update `src/shared/config.ts`.
- Add `apiTokenEnvVar` (optional string) to `AgentSchema` and `Agent` type.
- Add `apiUrlEnvVar` (optional string) to `AgentSchema` and `Agent` type.

**Verification:**
- Run `npm run format` and `npm run lint:fix`.
- Run `npm run validate` to ensure type checking and tests pass.

## Step 2: Update Lite Client Resolution Logic
**Status**: Completed

**Tasks:**
- Update `src/cli/lite.ts` to dynamically resolve authentication environment variables.
- Read pointer variables: `process.env.CLAW_LITE_API_VAR` and `process.env.CLAW_LITE_URL_VAR`.
- Resolve token: If `CLAW_LITE_API_VAR` is set, use `process.env[process.env.CLAW_LITE_API_VAR]`. Otherwise, fallback to `process.env.CLAW_API_TOKEN`.
- Resolve URL: If `CLAW_LITE_URL_VAR` is set, use `process.env[process.env.CLAW_LITE_URL_VAR]`. Otherwise, fallback to `process.env.CLAW_API_URL`.
- Ensure appropriate error handling if the resolved variables are missing or empty.

**Verification:**
- Run `npm run format` and `npm run lint:fix`.
- Run `npm run validate` to ensure code compiles.

## Step 3: Update Daemon Environment Variable Injection
**Status**: Completed

**Tasks:**
- Update `src/daemon/agent/agent-session.ts`.
- When spawning an agent, check for `agent.apiTokenEnvVar` and `agent.apiUrlEnvVar`.
- If `apiTokenEnvVar` is defined, inject the token into the custom variable and set `CLAW_LITE_API_VAR` to the custom variable name. Do not inject `CLAW_API_TOKEN`.
- If `apiUrlEnvVar` is defined, inject the URL into the custom variable and set `CLAW_LITE_URL_VAR` to the custom variable name. Do not inject `CLAW_API_URL`.
- If they are not defined, inject `CLAW_API_TOKEN` and `CLAW_API_URL` as usual.

**Verification:**
- Run `npm run format` and `npm run lint:fix`.
- Run `npm run validate` to ensure tests still pass.

## Step 4: Add and Update E2E Tests
**Status**: Not Started

**Tasks:**
- Update existing E2E tests (e.g., `src/cli/e2e/daemon.test.ts`, `src/cli/e2e/export-lite-func.test.ts`, `src/cli/e2e/requests.test.ts`) if they explicitly check for the hardcoded `CLAW_API_TOKEN` but shouldn't, or update them to verify default behavior remains intact.
- Add a new specific test case configuring an agent with both `apiTokenEnvVar` and `apiUrlEnvVar`.
- Verify that the daemon correctly injects the custom variables and the pointer variables (`CLAW_LITE_API_VAR`, `CLAW_LITE_URL_VAR`).
- Verify that an invocation of `clawmini-lite` via the CLI or mock successfully authenticates using these redirected variables.

**Verification:**
- Run `npm run format` and `npm run lint:fix`.
- Run `npm run validate` to verify all new and existing tests pass successfully.
