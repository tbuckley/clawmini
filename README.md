# Clawmini

Clawmini is an orchestration layer for command-line AI agents, providing a unified chat experience that can span multiple conversations and multiple agents. Ultimately, it aims to deliver a personal assistant experience built entirely on top of your local tools and agents.

## Features

- **Persistent, Multi-Agent Chat Sessions:** Maintain separate chats for different tasks, allowing you to converse with multiple agents across multiple conversations.
- **Safe Concurrency:** Automatically manages state and handles race conditions, queuing background commands safely to prevent file lock issues.
- **Built-in & Bring-Your-Own UI:** Includes a fast, beautifully designed SvelteKit Web UI to visually manage agents, chats, and monitor real-time execution. Alternatively, easily build and connect your own interfaces to its local API.
- **Agent Templates:** Quickly scaffold new agents using built-in or custom templates (e.g. `gemini`), automatically merging configuration settings.
- **Routers & Middleware Pipeline:** Process user messages through an extensible pipeline to dynamically alter content, target specific agents or sessions, and expand slash commands before they reach an agent.
- **Local File System Storage:** Everything is stored completely locally in `.clawmini/` within your workspace as transparent JSON/JSONL files. No cloud syncing required.
- **Sandboxed Agent API:** The daemon can optionally expose a secure HTTP server configured via the `api` setting in `.clawmini/settings.json`, allowing remote or containerized access. Give agents a minimal zero-dependency standalone client exported via `clawmini export-lite`. It securely authenticates with the Agent API using dynamically generated HMAC tokens (`CLAW_API_TOKEN`) to allow sandboxed agents to log messages and manage cron jobs without needing direct access to the host's Unix socket.
- **Proactivity:** Incoming messages or events from various external sources can be proactively routed back to the user or directly to the agent for autonomous handling.

### Coming Soon

- **Human Approval Requests:** When an agent needs permission to execute a sensitive action or requires input, it will pause and ask the user for approval via a dedicated UI or dashboard.

## Quick Start

Assuming you have built and linked the package globally:

```bash
# Initialize a new .clawmini settings folder, create an agent named 'coder' with the 'gemini-cladding' template, and set it as the default chat
clawmini init --agent coder --agent-template gemini-cladding

# Start the local web interface on http://localhost:8080
clawmini web
```

## Command Reference

### Initialization & Daemon

- `clawmini init`: Initialize a new `.clawmini` configuration folder.
- `clawmini up`: Start the local daemon server in the background.
- `clawmini down`: Stop the local daemon server.
- `clawmini export-lite [--out <path>] [--stdout]`: Export the standalone `clawmini-lite` client script for use in sandboxed environments.

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
- `clawmini agents add <id> [-d, --directory <dir>] [-t, --template <name>] [-e, --env <KEY=VALUE>...]`: Create a new agent, optionally setting its working directory, applying a template, and environment variables.
- `clawmini agents update <id> [-d, --directory <dir>] [-e, --env <KEY=VALUE>...]`: Update an existing agent's configuration.
- `clawmini agents delete <id>`: Remove an agent.

### Cron Jobs

- `clawmini cron list [--chat <id>]`: Display all cron jobs configured for a chat.
- `clawmini cron add <name> [--cron <expr> | --every <duration> | --at <iso-time>] [-m, --message <text>]`: Create a new scheduled job. Supports standard cron expressions, recurring intervals (e.g., `10m`), or one-off executions at a specific time.
- `clawmini cron delete <name> [--chat <id>]`: Remove an existing scheduled job.

### Web Interface

- `clawmini web [-p, --port <number>]`: Start the local web interface (default port: 8080).

## Configuration

## Global settings

**TODO**

## Routers

Clawmini provides an extensible pipeline for processing user messages before they reach an agent using **Routers**. By defining a sequence of routers in your `.clawmini/settings.json` (global) or per-chat settings, you can dynamically alter message content, target specific agents or sessions, inject environment variables, and add automated replies.

Built-in routers include:

- `@clawmini/slash-new`: Creates a new session ID when a message starts with `/new`, effectively clearing the context window for the agent.
- `@clawmini/slash-command`: Expands slash commands (e.g., `/foo`) with the contents of matching files in your `.clawmini/commands/` directory.

You can also write custom shell script routers that accept the current state via `stdin` and output JSON to dynamically control the routing logic. See the [`RouterState` interface](src/daemon/routers/types.ts) for the exact input and output schema.

## Agent Templates

Clawmini provides built-in templates to help you quickly scaffold new agents with pre-configured settings and files. When you run `clawmini agents add <id> --template <name>`, it copies the template's files into the agent's working directory and merges any provided environment variables or directory options with the template's `settings.json`.

The currently available built-in templates are:

- `gemini`: A basic template configured to use the `gemini` CLI as the agent's backend.
- `gemini-cladding`: A template configured to run the `gemini` CLI wrapped inside `cladding` for enhanced security.
- `gemini-claw-cladding`: A comprehensive template that sets up an autonomous personal assistant workspace (OpenClaw). It includes the `gemini-cladding` setup plus a full suite of scaffolding files like `GEMINI.md`, `SOUL.md`, `MEMORY.md`, and `HEARTBEAT.md` to establish the agent's identity, memory, and proactive capabilities.

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
