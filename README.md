# Clawmini

Clawmini delivers a personal assistant experience built entirely on top of your local tools and agents. It acts as an orchestration layer for command-line AI agents, providing a unified chat experience that can span multiple conversations and multiple agents.

## Features

- **Local-First AI Orchestration:** Built to run entirely locally on top of your existing CLI agents like Gemini CLI, Google Cloud Code, or OpenAI Codecs. Everything is stored locally in `.clawmini/` within your workspace as transparent JSON/JSONL files.
- **Secure by Default:** Features built-in sandboxing to isolate agents. The daemon securely authenticates with the Agent API using dynamically generated HMAC tokens (`CLAW_API_TOKEN`) allowing sandboxed agents to operate safely without direct access to the host's Unix socket.
- **Proactivity & Autonomy:** Agents can schedule recurring tasks for themselves to operate autonomously, proactively routing incoming messages or events from external sources back to the user or directly to the agent.
- **Human Approval Workflows:** Secure requests are gated by user permission. Agents can ask for your approval to run specific allowed scripts that you have configured, ensuring you remain in control of sensitive actions.
- **Built-in & Bring-Your-Own UI:** Includes a fast, beautifully designed SvelteKit Web UI to visually manage agents, chats, and monitor real-time execution. Alternatively, easily build and connect your own interfaces to its local API.
- **Extensible Pipeline:** Process user messages through customizable routers to dynamically alter content, target specific agents or sessions, and expand slash commands before they reach an agent.

## Quick Start

You can install Clawmini globally via npm:

```bash
npm install -g clawmini

# Initialize a new .clawmini settings folder, create an agent named 'jeeves' with the 'gemini' template
clawmini init --agent jeeves --agent-template gemini --environment macos

# Start the local daemon server in the background
clawmini up

# Start the local web interface on http://localhost:8080
clawmini web
```

_Note: The `macos` environment provides a basic sandbox. For more secure options, consider exploring the `cladding` or `macos-proxy` environments with `clawmini environments enable <name>`._

### Discord Integration Setup

You can easily connect Clawmini to a Discord server:

```bash
# Initialize the Discord adapter configuration
clawmini-adapter-discord init

# Start the Discord adapter server
clawmini-adapter-discord
```

### Guides

- [Discord Integration Setup](./docs/guides/discord_adapter_setup.md)
- [Sandbox Policies & Environments](./docs/guides/sandbox_policies.md)

## Command Reference

### Initialization & Daemon

- `clawmini init`: Initialize a new `.clawmini` configuration folder.
- `clawmini up`: Start the local daemon server in the background.
- `clawmini down`: Stop the local daemon server.
- `clawmini export-lite [--out <path>] [--stdout]`: Export the standalone `clawmini-lite` client script.

### Chat Management

- `clawmini chats list`: Display existing chats.
- `clawmini chats add <id>`: Initialize a new chat.
- `clawmini chats delete <id>`: Remove a chat.
- `clawmini chats set-default <id>`: Update the workspace default chat.

### Messaging

- `clawmini messages send <message> [--chat <id>] [--agent <name>]`: Send a new message.
- `clawmini messages tail [-n NUM] [--json] [--chat <id>]`: View message history.

### Agents

- `clawmini agents list`: Display existing agents.
- `clawmini agents add <id> [-d, --directory <dir>] [-t, --template <name>] [-e, --env <KEY=VALUE>...]`: Create a new agent.
- `clawmini agents update <id> [-d, --directory <dir>] [-e, --env <KEY=VALUE>...]`: Update an existing agent.
- `clawmini agents delete <id>`: Remove an agent.

### Background Jobs

- `clawmini jobs list [--chat <id>]`: Display all background jobs configured.
- `clawmini jobs add <name> [--cron <expr> | --every <duration> | --at <iso-time>] [-m, --message <text>]`: Create a new scheduled job. Supports standard cron expressions, recurring intervals (e.g., `10m`), or one-off executions at a specific time.
- `clawmini jobs delete <name> [--chat <id>]`: Remove an existing scheduled job.

### Environments

- `clawmini environments enable <name>`: Enable an environment for a path in the workspace.
- `clawmini environments disable`: Disable an environment mapping.

### Web Interface

- `clawmini web [-p, --port <number>]`: Start the local web interface (default port: 8080).

## Built-in Environments

Clawmini provides built-in environments to securely execute agent commands. MacOS variants leverage the built-in sandbox-exec command. For the most secure approach, `cladding` uses a containerized environment with limited network access. The built-in environments are:

- `cladding`: A container-based sandbox using [cladding](https://github.com/dstoc/cladding)
- `macos`: A macOS sandbox environment that restricts write-access to the workspace; edit `.clawmini/environments/macos/seatbelt.sb` to configure what is accessible.
- `macos-proxy`: A more constrained macOS sandbox environment, building on top of the restricted write-access of `macos` with a proxy that limits network access; edit `.clawmini/environments/macos/allowlist.txt` to configure allowed domains.

## Routers

Clawmini provides an extensible pipeline for processing user messages before they reach an agent using **Routers**. By defining a sequence of routers in your `.clawmini/settings.json` (global) or per-chat settings, you can dynamically alter message content, target specific agents or sessions, inject environment variables, and add automated replies.

Built-in routers include:

- `@clawmini/slash-new`: Creates a new session ID when a message starts with `/new`, effectively clearing the context window for the agent.
- `@clawmini/slash-command`: Expands slash commands (e.g., `/foo`) with the contents of matching files in your `.clawmini/commands/` directory.

You can also write custom shell script routers that accept the current state via `stdin` and output JSON to dynamically control the routing logic. See the `RouterState` interface for the exact input and output schema.

## Agent Templates

Clawmini provides built-in templates to help you quickly scaffold new agents with pre-configured settings and files. When you run `clawmini init --agent <name> --agent-template <template_name>` (or `clawmini agents add`), it copies the template's files into the agent's working directory and merges any provided configuration.

The currently available built-in templates are:

- `gemini`: A basic template configured to use the `gemini` CLI as the agent's backend.
- `gemini-claw`: A comprehensive template that sets up an autonomous personal assistant workspace. It includes security sandboxing setups plus a full suite of scaffolding files like `GEMINI.md`, `SOUL.md`, `MEMORY.md`, and `HEARTBEAT.md` to establish the agent's identity, memory, and proactive capabilities.

## `clawmini-lite`

Agents can be given a minimal, zero-dependency standalone client exported via `clawmini export-lite`. It securely authenticates with the Agent API using dynamically generated HMAC tokens (`CLAW_API_TOKEN`) to allow sandboxed agents to log messages, call permitted scripts, and manage cron jobs without needing direct access to the host's Unix socket. This makes it perfect for containerized or heavily sandboxed environments.

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
