# Product Requirements Document: Multiple Agents Support

## Vision
To enhance the flexibility of `clawmini` by allowing users to define and interact with multiple distinct agents within a single workspace. This enables multi-agent workflows where different tasks can be delegated to differently-configured agents (e.g., different LLM models, varying temperature settings, or distinct operating directories).

## Product/Market Background
Currently, `clawmini` supports a single, globally defined `defaultAgent` in the workspace `.clawmini/settings.json`. While effective for simple use cases, power users need the ability to maintain concurrent chats with different configurations. By treating the workspace `defaultAgent` as a base configuration and allowing specific agents to extend and override it, users gain maximum flexibility with minimal boilerplate.

## Use Cases
- A user wants one chat to use a fast, lightweight model (e.g., for quick queries) and another to use a slower, "thinking" model (e.g., for complex reasoning), seamlessly switching between them or creating them via the Web UI.
- A user wants an agent to execute its commands within a specific subdirectory of the project instead of the project root.
- A user wants to define specialized agents with different prompt instructions injected via environment variables.

## Requirements

### 1. Agent Configuration
- **Storage Location**: Agents must be stored in `.clawmini/agents/<agentId>/settings.json`.
- **Schema**:
  - `commands`: Inherits and overrides individual command strings (`new`, `append`, `getSessionId`, `getMessageContent`) from the global `defaultAgent.commands`.
  - `env`: Key-value pairs that extend/override the global `defaultAgent.env`.
  - `directory`: The absolute or relative path (from the workspace root) used as the `cwd` when executing the agent's commands. Defaults to `./<agentId>`.
- **Resolution Logic**: When an agent's command is executed, its configuration must be deep-merged over the workspace `defaultAgent` configuration.

### 2. CLI Interface
Add a new command group: `clawmini agents` with the following subcommands:
- `add <name> [--directory <dir>] [--env <key=value>...]`: Creates a new agent.
- `update <name> [--directory <dir>] [--env <key=value>...]`: Updates an existing agent.
- `delete <name>`: Deletes the agent and its directory under `.clawmini/agents/<name>`.
- `list`: Lists all configured agents.

Update the `messages` command:
- `clawmini messages send [--agent <name>] "message"`: The `--agent` flag updates the chat's `.clawmini/chats/<chatId>/settings.json` so that subsequent messages in the chat use this agent. If omitted, it defaults to the existing agent for the chat, or the global `defaultAgent` if none is set. If the specified agent does not exist, the command must fail and output an error message (e.g., "Error: agent '<name>' does not exist").

### 3. Web UI Integration
- **Agent Creation**: A form to create new agents (providing name, and optional directory/env variables) must be added to the Web UI.
- **Chat Creation**: When creating a new chat, the user must be presented with a dropdown to select the initial agent for that chat. The default option should be the workspace's default agent.
- **Backend API**: New REST API endpoints (e.g., `/api/agents`) must be implemented to support listing, creating, updating, and deleting agents from the UI.

### 4. Daemon Updates
- The daemon message handler (`src/daemon/message.ts`) must read the targeted chat's configuration to identify its active agent.
- It must then fetch the specified agent's configuration from `.clawmini/agents/<agentId>/settings.json` (falling back to just the global settings if the agent is "default").
- It must apply the agent-specific `env` and `commands` overrides over the global `defaultAgent` configuration.
- It must use the agent's `directory` as the `cwd` for the spawned child process.

## Security & Constraints
- **Path Traversal**: Ensure that agent creation validates the `<name>` to prevent directory traversal attacks (e.g., rejecting `../`).
- **Data Integrity**: When merging the configurations, it must be a pure override, ensuring that sensitive command definitions in the global settings are not corrupted.
