# Clawmini

Clawmini is an orchestration layer for command-line AI agents, providing a unified chat experience that can span multiple conversations and multiple agents. Ultimately, it aims to deliver a personal assistant experience built entirely on top of your local tools and agents.

## Features

- **Persistent, Multi-Agent Chat Sessions:** Maintain separate chats for different tasks, allowing you to converse with multiple agents across multiple conversations.
- **Safe Concurrency:** Automatically manages state and handles race conditions, queuing background commands safely to prevent file lock issues.
- **Built-in & Bring-Your-Own UI:** Includes a fast, beautifully designed SvelteKit Web UI to visually manage agents, chats, and monitor real-time execution. Alternatively, easily build and connect your own interfaces to its local API.
- **Local File System Storage:** Everything is stored completely locally in `.clawmini/` within your workspace as transparent JSON/JSONL files. No cloud syncing required.

## Coming Soon

- **Proactivity:** Incoming messages or events from various external sources can be proactively routed back to the user or directly to the agent for autonomous handling.
- **Human Approval Requests:** When an agent needs permission to execute a sensitive action or requires input, it will pause and ask the user for approval via a dedicated UI or dashboard.

## Quick Start

Assuming you have built and linked the package globally:

```bash
# Initialize a new .clawmini settings folder in your project
clawmini init

# Create a new agent with a specific working directory
clawmini agents add coder --directory ./src

# Start the background daemon server
clawmini up

# Send a message to the daemon, handled by the new agent
clawmini messages send "Hello world!" --agent coder

# View the chat history in the terminal
clawmini messages tail

# Start the local web interface on http://localhost:8080
clawmini web
```

## Command Reference

### Initialization & Daemon

- `clawmini init`: Initialize a new `.clawmini` configuration folder.
- `clawmini up`: Start the local daemon server in the background.
- `clawmini down`: Stop the local daemon server.

### Chat Management

- `clawmini chats list`: Display all existing chats in the workspace.
- `clawmini chats add <id>`: Create a new chat with the specified identifier.
- `clawmini chats delete <id>`: Remove a chat and its associated history.
- `clawmini chats set-default <id>`: Update the globally configured default chat for the workspace.

### Messaging

- `clawmini messages send <message> [--chat <id>] [--agent <name>]`: Send a message to a specific chat (defaults to the workspace default chat). Use `--agent` to assign a specific agent to handle the message.
- `clawmini messages tail [-n NUM] [--json] [--chat <id>]`: Display the most recent messages and command logs in a chat.

### Agents

- `clawmini agents list`: Display all existing agents.
- `clawmini agents add <id> [-d, --directory <dir>] [-e, --env <KEY=VALUE>...]`: Create a new agent, optionally setting its working directory and environment variables.
- `clawmini agents update <id> [-d, --directory <dir>] [-e, --env <KEY=VALUE>...]`: Update an existing agent's configuration.
- `clawmini agents delete <id>`: Remove an agent.

### Web Interface

- `clawmini web [-p, --port <number>]`: Start the local web interface (default port: 8080).

## Development Setup

Clawmini is a monorepo consisting of a Node.js TypeScript CLI/Daemon and an embedded SvelteKit frontend (in the `web/` workspace).

### Prerequisites

- Node.js (v18+)
- npm

### Setup

```bash
# Install dependencies for both the root CLI and the web workspace
npm install

# Build the CLI, Daemon, and statically compile the Web UI
npm run build
```

### Development Scripts

During development, you can run the following commands from the root:

```bash
# Watch mode for the CLI
npm run dev:cli

# Watch mode for the Daemon
npm run dev:daemon

# Run formatting, linting, type-checking, and tests
npm run format
npm run lint
npm run check
npm run test
```

## Architecture Notes

- **Separation of Concerns:** The daemon (`src/daemon`) acts as the stateful orchestrator and queue manager, while the CLI (`src/cli`) is simply a thin TRPC client connecting via a UNIX socket.
- **Web UI:** The `web/` directory is a SvelteKit application built with `@sveltejs/adapter-static`. Running `npm run build` bundles the web UI into `dist/web`, which is then served statically by the `clawmini web` Node.js server. Real-time updates to the web UI are powered by Server-Sent Events (SSE) tailing the local `.clawmini/chats/:id/chat.jsonl` files.
