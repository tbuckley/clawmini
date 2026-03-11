# Command Reference

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
