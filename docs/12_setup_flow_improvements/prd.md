# Product Requirements Document: Setup Flow Improvements

## 1. Vision
To streamline the `clawmini` initial workspace setup and agent creation processes. Creating an agent should provide an immediate, dedicated space to converse with it. Initializing a workspace should optionally allow the user to bootstrap it with a specific agent directly.

## 2. Product/Market Background
Currently, the process of initializing a clawmini workspace and adding an agent requires multiple distinct commands (`clawmini init`, then `clawmini agents add <name>`). Additionally, when an agent is created, the user isn't automatically provided with a dedicated chat configured for that agent. Streamlining this will improve user onboarding and reduce command overhead for standard workflows.

## 3. Use Cases
1. **Quick Start**: A new user wants to set up a workspace and get right into using a predefined agent template. They run `clawmini init --agent bob --agent-template bob-template` and can immediately start chatting with `bob` in a dedicated chat also named `bob`.
2. **Dedicated Contexts**: A developer creates a new agent using `clawmini agents add react-expert`. The system automatically spins up a chat called `react-expert` where `react-expert` is the default agent, keeping contexts nicely separated.
3. **Preventing Accidental Overwrites**: A user creates an agent named `default`, but a `default` chat already exists. The system creates the agent, but avoids overwriting the existing `default` chat settings, warning the user instead.
4. **Environment Initialization**: A user wants to initialize a workspace that immediately utilizes a specific environment sandbox (like `cladding`). They run `clawmini init --environment cladding`.

## 4. Requirements

### 4.1. Agent Creation Flow (`clawmini agents add`)
- **Chat Creation Side-effect**: When a user successfully creates a new agent via `clawmini agents add <id>`, the system MUST automatically attempt to create a chat with the exact same `<id>`.
- **Default Agent Assignment**: If the chat with `<id>` did NOT previously exist, the newly created chat MUST have its `defaultAgent` set to the newly created agent `<id>` in its `chat.json` settings.
- **Handling Existing Chats**: If a chat with `<id>` ALREADY exists, the system MUST NOT overwrite or mutate the existing chat's settings (leave it untouched) and MUST output a warning to the user indicating that the chat already existed.

### 4.2. Workspace Initialization Flow (`clawmini init`)
- **New Flags**: The `init` command MUST support three new optional flags:
  - `--agent <name>`: The name of the agent to create after initialization.
  - `--agent-template <name>`: The template to apply to the created agent.
  - `--environment <name>`: The environment to enable for the workspace root (`./`) after initialization.
- **Agent Initialization**: If `--agent <name>` is provided, the command MUST execute the equivalent of `clawmini agents add <name>` (including the new chat creation side-effect).
- **Template Dependency**: If `--agent-template <name>` is provided but `--agent <name>` is OMITTED, the command MUST throw an error.
- **Workspace Default Chat**: If `--agent <name>` is provided, the command MUST set the workspace's default chat (`settings.chats.defaultId` in `.clawmini/settings.json`) to `<name>`.
- **Environment Initialization**: If `--environment <name>` is provided, the command MUST execute the equivalent of `clawmini environments enable <name>`, enabling the specified environment for the workspace root (`./`).

## 5. Security / Privacy / Accessibility Concerns
- **Security**: Creating chats involves filesystem writes (`mkdir`, `writeFile`). Input validation for the agent/chat ID already exists (`isValidAgentId`) but we must ensure it's strictly applied to prevent directory traversal attacks. We must ensure the chat directory is always created within the designated workspace `chats` folder.
- **Accessibility/UX**: The warning for an existing chat during agent creation must be clearly visible so users understand why the chat wasn't configured to their new agent.
- **Privacy**: No new privacy concerns. Chat data remains local to the workspace.
