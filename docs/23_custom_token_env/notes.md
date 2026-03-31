# Notes on Custom Token Env

## Current Behavior
- The daemon securely authenticates with the Agent API using a dynamically generated HMAC token (`CLAW_API_TOKEN`).
- `src/daemon/agent/agent-session.ts` injects `CLAW_API_URL` and `CLAW_API_TOKEN` into the environment of the executed agent process.
- `src/cli/lite.ts` (which compiles to `clawmini-lite.js`) reads these via `process.env.CLAW_API_URL` and `process.env.CLAW_API_TOKEN`.
- E2E tests (`src/cli/e2e/`) check for `CLAW_API_TOKEN=` in the environment variables.

## Issue
- Gemini CLI strips out environment variables that include `TOKEN`, `KEY`, `SECRET`, etc., unless they have the `GEMINI_CLI_` prefix.
- Therefore, when Clawmini runs Gemini CLI as an agent, `CLAW_API_TOKEN` is stripped, and `clawmini-lite.js` (used for fallbacks or tool usage) cannot authenticate.

## Solution Direction
- Allow configuring an alternative env var name to pass the token (e.g., `GEMINI_CLI_CLAW_API_TOKEN`).
- If this is configured, the daemon must inject the token using this alternative name.
- We need a way to tell `clawmini-lite.js` which environment variable contains the token, since it won't be `CLAW_API_TOKEN` anymore. This pointer variable itself must not contain the words `TOKEN`, `KEY`, or `SECRET` to avoid being stripped.