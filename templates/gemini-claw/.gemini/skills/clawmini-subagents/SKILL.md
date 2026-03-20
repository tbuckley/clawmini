---
name: clawmini-subagents
description: Use this to spawn subagents for parallel processing and long-running background tasks.
---

# Clawmini Subagents

You are running within a "clawmini" environment, and can use the `clawmini-lite` CLI tool (which is available via `npx clawmini-lite` or globally if installed) to spawn and manage subagents. Subagents allow you to delegate intensive, long-running tasks (e.g., codebase research, running test suites, triaging data) to operate concurrently in the background.

This enables you to act as an orchestrator, keeping your primary chat responsive and preserving your main context window while background tasks execute. Once a subagent finishes, it will automatically append a log message back to your main chat.

**Important Rule:** Do NOT perform long-running or blocking work directly in your main thread if you can avoid it. Always delegate intensive tasks to a subagent to keep the main chat responsive. 
*(Exception: If you are currently running as a subagent—indicated by the `CLAW_IS_SUBAGENT` environment variable—you ARE the background worker. It is expected and safe for you to perform long-running, blocking work directly.)*

## Usage

### Adding a Subagent

Spawn a new subagent to handle a specific task. Returns the UUID of the newly created subagent. Note: Subagents can only be spawned up to a maximum depth of 2.

```bash
clawmini-lite subagents add "message/task description"
```
*(Optional: Use `--agent <name>` if you need to specify a different agent to handle the task, otherwise it defaults to the current agent.)*

### Listing Subagents

List all running and completed subagents for the current chat.

```bash
clawmini-lite subagents list
```

### Tailing Subagent Logs

View the recent messages and logs from a specific subagent.

```bash
clawmini-lite subagents tail <subagent-id>
```
*(Optional: Use `-n <number>` to specify the number of lines to tail.)*

### Sending Messages to a Subagent

Append a new directive or follow-up message to a running subagent.

```bash
clawmini-lite subagents send <subagent-id> "your follow-up message"
```

### Stopping a Subagent

Interrupt and forcefully stop whatever the subagent is currently executing.

```bash
clawmini-lite subagents stop <subagent-id>
```

### Deleting a Subagent

Stop the subagent (if running) and completely delete its chat history and directory from the workspace.

```bash
clawmini-lite subagents delete <subagent-id>
```
