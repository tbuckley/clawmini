# Clawmini

**The secure, local-first orchestrator for your AI agents.**

Clawmini gives you the power of a proactive personal AI assistant, without compromising your system's security. Unlike other local agents that run with unrestricted access to your machine, Clawmini is built from the ground up with **sandboxing**, **human-in-the-loop approvals**, and **strict network isolation**.

Bring your favorite CLI agents (Gemini CLI, Claude Code, OpenAI Codex, etc.), and Clawmini provides the memory, the chat support, and the security boundaries.

## Why Clawmini?

🛡️ **Zero-Trust Security by Default**
Run agents safely. Clawmini uses built-in sandboxing (macOS seatbelt or containerized environments) to restrict what your AI can touch. Sensitive actions require your explicit approval before execution.

🧠 **Persistent Memory & Proactivity**
Your agents don't just react; they act. Clawmini allows agents to schedule recurring tasks (cron jobs), maintain long-term context across sessions, and proactively notify you of updates or route messages from external sources.

💻 **Beautiful Web UI & Chat App Extensibility**
No need to stay in the terminal. Manage your agents and chat with them through a fast, built-in Web interface running entirely on `localhost`. Hook up Discord to chat on-the-go, or easily build your adapters against the local API.

🔌 **Bring Your Own Agent**
Clawmini isn't tied to one model. It orchestrates _any_ CLI-based agent, acting as the secure bridge between the AI and your filesystem.

## Quick Start: Meet Jeeves

Let's set up a secure, sandboxed agent named Jeeves using the Gemini CLI template.

```bash
# 1. Install globally
npm install -g clawmini

# 2. Initialize a workspace and create your first sandboxed agent
# Note: For a more basic experience, you can use the 'gemini' template instead
mkdir my-workspace && cd my-workspace
clawmini init --agent jeeves --agent-template gemini-claw --environment macos

# 3. Start the daemon + web UI (plus any configured adapters) with visible logs
clawmini serve

# Or run it in the background and tail logs separately:
#   clawmini serve --detach
#   clawmini logs -f
```

**Try asking Jeeves:** _"Summarize the recent changes in my git repository."_ Jeeves will run securely in its sandbox, read the diffs, and report back.

**What's going on?** When you send a message, Clawmini looks at the chat+message and then launches Gemini CLI with your message in the `jeeves/` directory. The `jeeves/` directory is set up with OpenClaw-like files and system prompt since you used the `gemini-claw` template. And since we chose the `macos` environment, Gemini CLI will run in a built-in Seatbelt sandbox that prevents it from editing anything outside your workspace folder. We additionally give Gemini CLI ways to schedule reminders and recurring tasks, send files, and request permissions to run sensitive commands (see Permission Requests).

### Common Slash Commands

You can use these built-in slash commands in your chat interfaces:

- `/new`: Clear previous context and start a new conversation thread.
- `/stop`: Stop all running commands and drop any queued messages.
- `/interrupt [message]`: Interrupt the current thinking, batching together all queued messages and sending them immediately.
- `/pending`: View any pending permission requests from your agent.
- `/approve [id]`: Approve a specific pending agent request.
- `/reject [id]`: Reject a specific pending agent request.

### Guides & Integrations

- [Discord Integration Setup](./docs/guides/discord_adapter_setup.md)
- [Configuring Permission Requests](./docs/guides/sandbox_policies.md)

## How It Works

**User** ↔️ **Web UI / CLI** ↔️ **Daemon** ↔️ **Sandbox / Environment** ↔️ **Agent**

The daemon securely authenticates with the Agent API using dynamically generated HMAC tokens (`CLAW_API_TOKEN`), allowing sandboxed agents to operate safely without direct access to the host's Unix socket.

### Built-in Environments

- `cladding` (most secure): A container-based sandbox using [cladding](https://github.com/dstoc/cladding)
- `macos`: A macOS sandbox environment that restricts write-access to the workspace.
- `macos-proxy`: A more constrained macOS sandbox that limits network access to an allowlist.

### Extensible Pipeline (Routers)

Process user messages before they reach an agent. Dynamically alter content, target specific agents, or expand slash commands (e.g., `/new` to clear context, `/foo` to expand a command script).

**Configuring Routers:**
You can configure the active routers in your workspace's `.clawmini/settings.json` file or on a per-chat basis in `.clawmini/chats/<id>/settings.json`.

```json
{
  "routers": [
    "@clawmini/slash-new",
    "@clawmini/slash-command",
    {
      "use": "@clawmini/session-timeout",
      "with": {
        "timeout": "60m",
        "prompt": "This chat session has ended. Save any important details from it to your memory."
      }
    }
  ]
}
```

## Next Steps: Build Autonomous Workflows

Once you're comfortable, Clawmini offers powerful tools for advanced users:

- **The `gemini-claw` Template:** Scaffold a complete autonomous assistant with built-in memory management (`MEMORY.md`), identity (`SOUL.md`), and heartbeat checks (`HEARTBEAT.md`) for proactive tasking.
- **`clawmini-lite`:** Deploy agents into heavily restricted containers. Export the minimal, zero-dependency client (`clawmini export-lite`) to securely authenticate with the daemon, allowing the agent to log actions and request permissions without host access.

---

## Documentation & References

For a full list of commands for managing chats, messages, agents, background jobs, and environments, please see the [CLI Command Reference](./docs/CLI_REFERENCE.md).

## Development Setup

Clawmini is a monorepo consisting of a Node.js TypeScript CLI/Daemon and an embedded SvelteKit frontend (in the `web/` workspace).

### Prerequisites

- Node.js (v18+)
- npm

### Setup & Scripts

```bash
# Install dependencies and build the project
npm install
npm run build

# Development Watch Modes
npm run dev:cli
npm run dev:daemon

# Linting & Testing
npm run format
npm run lint
npm run check
npm run test
```

**Architecture Notes:**

- **Separation of Concerns:** The daemon (`src/daemon`) acts as the stateful orchestrator and queue manager, while the CLI (`src/cli`) is simply a thin TRPC client connecting via a UNIX socket.
- **Web UI:** The `web/` directory is a SvelteKit application built with `@sveltejs/adapter-static`. Running `npm run build` bundles the web UI into `dist/web`, which is served statically by the `clawmini web` Node.js server. Real-time updates use Server-Sent Events (SSE) tailing local `.clawmini/chats/:id/chat.jsonl` files.
