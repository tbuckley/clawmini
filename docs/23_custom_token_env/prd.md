# Product Requirements Document: Custom Token Environment Variables

## 1. Vision
Enable Clawmini to integrate seamlessly with strict sandboxes and external CLI tools (like Gemini CLI) that aggressively filter or strip environment variables containing sensitive keywords such as `TOKEN`, `KEY`, or `SECRET`. By allowing agents to configure custom names for the API URL and API Token environment variables, Clawmini ensures that injected authentication details reach the target agent process without being discarded by intermediate wrappers.

## 2. Product/Market Background
Clawmini securely authenticates spawned agents with its API using a dynamically generated HMAC token passed via the `CLAW_API_TOKEN` environment variable. The agent uses the lightweight `clawmini-lite.js` script to execute tasks (e.g., fallbacks, tool usage). However, some agents—such as the Gemini CLI—employ strict security measures that strip out environment variables matching sensitive keyword patterns unless explicitly prefixed (e.g., `GEMINI_CLI_`). This behavior breaks Clawmini's authentication flow because `CLAW_API_TOKEN` is stripped before `clawmini-lite.js` runs.

## 3. Use Cases
- **Running Gemini CLI as an Agent:** A user configures Gemini CLI as a Clawmini agent. They define `apiTokenEnvVar: 'GEMINI_CLI_CLAW_API_TOKEN'` in the agent configuration so that the authentication token bypasses Gemini CLI's environment variable filter.
- **Custom URL Overrides:** A user is running an agent inside an environment where `CLAW_API_URL` conflicts with an existing system variable or is stripped, and they need to map it to a custom variable name like `CUSTOM_API_HOST`.

## 4. Requirements

### 4.1. Configuration (`src/shared/config.ts`)
- Update the `AgentSchema` (and corresponding `Agent` type) to include two new optional string properties:
  - `apiTokenEnvVar`: Specifies an alternative environment variable name for the API token.
  - `apiUrlEnvVar`: Specifies an alternative environment variable name for the API URL.

### 4.2. Daemon Injection (`src/daemon/agent/agent-session.ts`)
- When spawning an agent, check if `agent.apiTokenEnvVar` and/or `agent.apiUrlEnvVar` are set.
- If `apiTokenEnvVar` is defined:
  - Inject the token into the specified custom environment variable (e.g., `GEMINI_CLI_CLAW_API_TOKEN`) instead of `CLAW_API_TOKEN`.
  - Inject a "pointer" environment variable named `CLAW_LITE_API_VAR` whose value is the name of the custom token variable (e.g., `"GEMINI_CLI_CLAW_API_TOKEN"`). This pointer must *not* be stripped by target tools, hence avoiding keywords like `TOKEN`.
- If `apiUrlEnvVar` is defined:
  - Inject the API URL into the specified custom environment variable instead of `CLAW_API_URL`.
  - Also ensure that `clawmini-lite.js` knows where to look for the URL (e.g., using another pointer variable like `CLAW_LITE_URL_VAR`, or encoding both in a structured way). Given the structure, a matching pointer for the URL `CLAW_LITE_URL_VAR` should be introduced.

### 4.3. Lite Client Updates (`src/cli/lite.ts`)
- `clawmini-lite.js` must be updated to dynamically resolve the environment variable names used for authentication.
- Read the pointer variables first (`process.env.CLAW_LITE_API_VAR` and `process.env.CLAW_LITE_URL_VAR`).
- If `CLAW_LITE_API_VAR` is set, read the token from `process.env[process.env.CLAW_LITE_API_VAR]`. Fallback to `process.env.CLAW_API_TOKEN` if the pointer is not set.
- If `CLAW_LITE_URL_VAR` is set, read the URL from `process.env[process.env.CLAW_LITE_URL_VAR]`. Fallback to `process.env.CLAW_API_URL` if the pointer is not set.
- Ensure appropriate error handling if the resolved variables are missing or empty.

### 4.4. Security Considerations
- The introduction of custom environment variables does not alter the fundamental HMAC authentication model. The token remains dynamically generated per execution and is only valid for its intended scope.
- The pointer variables (`CLAW_LITE_API_VAR`, `CLAW_LITE_URL_VAR`) must not contain sensitive strings like `TOKEN` to ensure they bypass downstream filters.

### 4.5. Testing
- **E2E Tests:** Update `src/cli/e2e/daemon.test.ts`, `src/cli/e2e/export-lite-func.test.ts`, and `src/cli/e2e/requests.test.ts` to accommodate or verify the fallback logic. 
- Write a specific test case that configures an agent with `apiTokenEnvVar` and `apiUrlEnvVar`, ensuring the daemon properly injects the custom and pointer variables, and verifying that a mock `clawmini-lite.js` invocation successfully authenticates using the redirected variables.