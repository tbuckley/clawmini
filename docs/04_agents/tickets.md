# Agents Feature Tickets

## Ticket 1: Core Configuration and Workspace Utility for Agents
**Description**: Define the `Agent` schema and add workspace utilities to manage agent configurations.
**Tasks**:
- Update `src/shared/config.ts` to include the `Agent` schema (with `commands`, `env`, and `directory` fields).
- Add utility functions to `src/shared/workspace.ts` to manage agent configurations (e.g., `getAgent`, `listAgents`, `writeAgentSettings`, `deleteAgent`).
- Ensure agent IDs are validated to prevent directory traversal attacks (e.g., rejecting paths with `../`).
- Add comprehensive unit tests in `src/shared/workspace.test.ts`.
**Verification**: 
Run automated checks:
```bash
npm run format:check && npm run lint && npm run check && npm run test
```
**Status**: Complete

## Ticket 2: Daemon Support for Agent Execution
**Description**: Update the daemon message handler to respect agent configurations and directory paths.
**Tasks**:
- Update `src/daemon/message.ts` to read the chat's active agent and merge its configuration over the global `defaultAgent` settings.
- Apply the merged `env` and `commands` to the agent execution.
- Adjust the child process execution to use the agent's `directory` as its `cwd` (resolving it relative to the workspace root, defaulting to `./<agentId>`).
- Add tests in `src/daemon/message.test.ts` to verify merging and directory assignment.
**Verification**: 
Run automated checks:
```bash
npm run format:check && npm run lint && npm run check && npm run test
```
**Status**: Complete

## Ticket 3: Agent CLI Commands (Add, Update, Delete, List)
**Description**: Implement the `clawmini agents` command group.
**Tasks**:
- Create `src/cli/commands/agents.ts` with subcommands: `add`, `update`, `delete`, and `list`.
- Parse `--directory` and `--env` flags for `add` and `update` commands.
- Register the `agents` command group in the main CLI entrypoint (`src/cli/index.ts`).
**Verification**: 
Run automated checks:
```bash
npm run format:check && npm run lint && npm run check && npm run test
```
**Status**: Complete

## Ticket 4: CLI Support for Selecting an Agent per Chat
**Description**: Update the CLI to allow switching the active agent for a specific chat.
**Tasks**:
- Update the `send` command in `src/cli/commands/messages.ts` to accept an `--agent <name>` flag.
- Validate that the requested agent exists; fail with a clear error if it doesn't.
- Update the chat's `.clawmini/chats/<chatId>/settings.json` to persist the selected agent for future messages.
**Verification**: 
Run automated checks:
```bash
npm run format:check && npm run lint && npm run check && npm run test
```
**Status**: Complete

## Ticket 5: Web UI API Endpoints for Agents
**Description**: Build REST API endpoints in the web project to manage agents.
**Tasks**:
- Create endpoints (e.g., `/api/agents` and `/api/agents/:id`) to handle fetching, creating, updating, and deleting agents from the Web UI.
- Use the shared workspace utilities to interact with the file system securely.
**Verification**: 
Run automated checks:
```bash
npm run format:check && npm run lint && npm run check && npm run test
```
**Status**: Complete

## Ticket 6: Web UI Integration for Agent Management & Chat Creation
**Description**: Build the frontend components for users to interact with agents.
**Tasks**:
- Add a new dialog or dedicated page in the UI to view, create, and manage agents (supporting `directory` and `env` configurations).
- Update the "New Chat" flow to include a dropdown for selecting the chat's initial agent.
- Integrate the frontend with the API endpoints created in Ticket 5.
**Verification**: 
Run automated checks:
```bash
npm run format:check && npm run lint && npm run check && npm run test
```
**Status**: Complete