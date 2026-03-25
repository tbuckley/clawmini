---
name: clawmini-subagents
description: Use this skill to spawn and manage subagents to delegate complex, parallel, or background tasks.
---

# Clawmini Subagents

You are running within a "clawmini" environment, and can use the `clawmini-lite.js` script (already on your PATH) to spawn and manage subagents. Subagents are separate agent instances that run concurrently and can help you complete complex or parallel tasks.

**Warning: Subagents run concurrently within the same workspace. Do not allow multiple subagents to edit the same files simultaneously.**

## Usage

### Spawning a Subagent

To create a new subagent and assign it a task:

```bash
clawmini-lite.js subagents spawn "<message>" [options]
```

- `<message>`: The initial prompt or task for the subagent.
- `--agent <agentId>`: (Optional) The specific agent profile to use.
- `--id <subagentId>`: (Optional) A custom ID for the subagent. If not provided, a random UUID is generated.
- `--async`: (Optional) Run the subagent asynchronously. By default, the CLI will block and wait for the subagent to complete unless it's a main agent (depth 0) or `--async` is passed.

When an async subagent completes, you will automatically receive a `<notification>` message containing its final output.

### Sending Messages to a Subagent

To send an additional message to an already running subagent:

```bash
clawmini-lite.js subagents send <subagentId> "<message>"
```

### Waiting for a Subagent

To block and wait for a specific subagent to complete its task:

```bash
clawmini-lite.js subagents wait <subagentId>
```

### Stopping a Subagent

To halt a running subagent:

```bash
clawmini-lite.js subagents stop <subagentId>
```

### Deleting a Subagent

To remove a subagent and clean up its resources:

```bash
clawmini-lite.js subagents delete <subagentId>
```

### Listing Subagents

To see your currently active or pending subagents:

```bash
clawmini-lite.js subagents list [options]
```

- `--pending`: Show only pending subagents.
- `--blocking`: Show subagents that are currently blocking.
- `--json`: Output the list in JSON format.

### Tailing Subagent Logs

If you need to fetch the recent messages or output of a specific subagent locally:

```bash
clawmini-lite.js subagents tail <subagentId>
```
