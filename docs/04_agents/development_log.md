# Development Log

## Ticket 1: Core Configuration and Workspace Utility for Agents

- **Implementation**: 
  - Extracted `AgentSchema` and `Agent` type to `src/shared/config.ts`.
  - Added utility functions in `src/shared/workspace.ts`: `getAgent`, `listAgents`, `writeAgentSettings`, `deleteAgent`.
  - Implemented `isValidAgentId` to prevent directory traversal attacks by disallowing paths with `../` or `/` or ``.
  - Re-wrote `src/shared/workspace.test.ts` to include tests for all the new functionality and path resolution methods.
- **Fixes**: Fixed a pre-existing lint issue in `src/cli/commands/web.ts` where a caught error `err` was unused.
- **Verification**: Ran `npm run format && npm run lint && npm run check && npm run test`, all checks passed. Tests run smoothly, including E2E.


## Ticket 2: Daemon Support for Agent Execution

- **Implementation**: 
  - Updated `src/daemon/message.ts` to fetch the chat`'s active agent and override the `defaultAgent` configurations dynamically.
  - Resolved `directory` relative to the workspace root using `getWorkspaceRoot(cwd)` to securely scope execution paths.
  - Allowed merging of custom agent `env` and `commands` correctly.
  - Added test cases in `src/daemon/message.test.ts` to explicitly test configuration merging and working directory assignments.
- **Fixes**: Fixed `message.test.ts` failing mock bindings after `getAgent` and `getWorkspaceRoot` were added to the `../shared/workspace.js` mock.
- **Verification**: Ran `npm run format && npm run lint && npm run check && npm run test`, all checks passed. Tests run smoothly, including the e2e tests.
\n## Ticket 3: Agent CLI Commands (Add, Update, Delete, List)\n\n- **Implementation**:\n  - Created `src/cli/commands/agents.ts` with `add`, `update`, `list`, and `delete` subcommands using commander.\n  - Added support for parsing multiple `--env KEY=VALUE` flags into an object record.\n  - Hooked up `--directory` flag to set the agent's `directory` setting.\n  - Imported and registered `agentsCmd` inside `src/cli/index.ts`.\n  - Wrote robust E2E tests in `src/cli/e2e.test.ts` simulating adding, listing, updating and deleting an agent.\n- **Verification**: Ran formatting, linting, type-check, and vitest test cases. All passed.

## Ticket 4: CLI Support for Selecting an Agent per Chat

- **Implementation**: 
  - Updated `src/cli/commands/messages.ts` `send` command to include a new `-a, --agent <name>` flag.
  - Implemented validation for the selected agent by leveraging `isValidAgentId` and verifying its existence using `getAgent`. If the agent fails validation, the CLI gracefully exits with a clear error message.
  - Added logic to automatically persist the selected agent to the chat's `settings.json` file using `readChatSettings` and `writeChatSettings`.
  - Added new E2E tests in `src/cli/e2e.test.ts` to ensure setting the agent works, persists, and using an invalid agent fails appropriately. Also increased the vitest `beforeAll` and `afterAll` hook timeouts for e2e tests from default to 30000ms.
- **Verification**: Ran `npm run format && npm run lint && npm run check && npm run test`, all checks passed.


## Ticket 5: Web UI API Endpoints for Agents

- **Implementation**:
  - Updated the internal HTTP server in `src/cli/commands/web.ts` to include REST endpoints for agent management under `/api/agents` and `/api/agents/:id`.
  - Added support for `GET`, `POST` (create), `PUT`/`POST` (update), and `DELETE` on these endpoints.
  - Used shared utilities `listAgents`, `getAgent`, `writeAgentSettings`, `deleteAgent`, and `isValidAgentId` from `src/shared/workspace.ts` to ensure interactions are secure.
  - Added API testing to the `should run web command and serve static files` test block in `src/cli/e2e.test.ts` to ensure proper routing, data returning, and persistence.
- **Verification**: Ran `npm run format && npm run lint && npm run check && npm run test`, fixed ESLint warnings for explicit `any` usage. All checks passed.
