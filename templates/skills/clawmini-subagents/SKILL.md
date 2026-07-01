---
name: clawmini-subagents
description: Use this skill to spawn and manage subagents to delegate complex, parallel, or background tasks.
---

# Clawmini Subagents

You are running within a "clawmini" environment, and can use the `clawmini-lite.js` script (already on your PATH) to spawn and manage subagents. Subagents are separate agent instances that run concurrently and can help you complete complex or parallel tasks.

**Warning: Subagents run concurrently within the same workspace. Do not allow multiple subagents to edit the same files simultaneously.**

**Approval gating:** every `subagents spawn` and `subagents send` is checked against the `subagents` rule list in `.clawmini/policies.json`. If no rule auto-approves the edge (and the built-in `$self → $self` rule does not apply), the operation returns `state: 'pending'` and waits for the user to `/approve <id>` or `/reject <id>`. Cross-agent spawns (e.g. `--agent other-agent`) will commonly need a user-managed rule.

## Observation, Listing, Cleanup → `delegations`

For kind-agnostic observation/cleanup primitives, see the `clawmini-delegations` skill. In particular:

- Wait for a subagent: `clawmini-lite.js delegations wait <id>`
- List your subagents: `clawmini-lite.js delegations list --kind subagent`
- Delete (and stop, if running): `clawmini-lite.js delegations delete <id>`

The legacy `subagents wait`, `subagents list`, and `subagents delete` subcommands have been removed.

## Usage

### Spawning a Subagent

To create a new subagent and assign it a task:

```bash
clawmini-lite.js subagents spawn "<message>" [options]
```

- `<message>`: The initial prompt or task for the subagent.
- `--agent <agentId>`: (Optional) The specific agent profile to use.
- `--id <subagentId>`: (Optional) A custom ID for the subagent. If not provided, a 3-character alphanumeric id is generated.
- `--delivery <manual|notify>`: (Optional) How the subagent's resolution is delivered.
  - `notify` (default for root-level spawns) appends a `<notification>` to the chat when the subagent completes.
  - `manual` (default for subagent-level spawns) stores the result on disk; observe it explicitly via `clawmini-lite.js delegations wait <id>` or `delegations notify-when <id>`.

When a `--delivery notify` subagent completes, you will automatically receive a `<notification>` message containing its final output. When a `--delivery manual` subagent completes, nothing is appended — you must observe the result via the `delegations` group.

### Sending Messages to a Subagent

To send an additional message to an already running subagent:

```bash
clawmini-lite.js subagents send <subagentId> -p "<message>" [--delivery <manual|notify>]
```

The `--delivery` flag has the same semantics as on `spawn`.

### Stopping a Subagent

To halt a running subagent:

```bash
clawmini-lite.js subagents stop <subagentId>
```

### Tailing Subagent Logs

If you need to fetch the recent messages or output of a specific subagent locally:

```bash
clawmini-lite.js subagents tail <subagentId>
```

## Fan-Out

To dispatch several subagents in parallel and wake on a single aggregated notification rather than one per child, use `--delivery manual` on each spawn plus a single `delegations notify-when ... --all`. See `clawmini-delegations/SKILL.md` for the pattern.
