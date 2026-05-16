---
name: clawmini-delegations
description: Use this skill to observe, fan out over, and clean up the unified work-in-flight surface that backs both policy requests and subagents.
---

# Clawmini Delegations

A **delegation** is any piece of work you have handed off to someone else and may
eventually want a result from. Today there are two kinds:

- **Policy** — a request submitted via `clawmini-lite.js request <cmd>`
  (see the `clawmini-requests` skill).
- **Subagent** — a child agent spawned via `clawmini-lite.js subagents spawn`
  (see the `clawmini-subagents` skill).

Both kinds share **one id space**, **one lifecycle**, and **one CLI group**
for waiting/listing/cleanup: `clawmini-lite.js delegations`. Use this group
whenever you need to observe in-flight work without caring whether it is a
policy or a subagent.

## Mental Model

Every delegation has:

- An **id** — a 3-character alphanumeric string, unique within the chat.
- A **kind** — `policy` or `subagent`.
- A **state** — `pending` → `running` → terminal (`completed` / `failed` /
  `rejected`). Records are retained on resolve so you can inspect the result
  afterward via `delegations show <id>`.
- A **delivery mode** — `notify` or `manual`. See "Delivery modes" below.

The lifecycle is identical for both kinds: states, terminal retention, and the
events the daemon emits on resolution are unified.

## Delivery Modes

`--delivery <mode>` is passed at creation time (`subagents spawn|send`,
`request <cmd>`).

- `notify` — when the delegation resolves, the daemon appends a
  `<notification>` message into the chat, waking the agent. This is the
  default for root-level work.
- `manual` — the result is stored on disk but **no** `<notification>` is
  appended. The agent observes the result by calling `delegations wait`,
  `delegations show`, or `delegations notify-when`. This is the default for
  work spawned from inside a subagent.

## CLI Group

```bash
clawmini-lite.js delegations list [--state <s>] [--kind <k>] [--json]
clawmini-lite.js delegations show <id>
clawmini-lite.js delegations wait <id> [<id> ...] [--all] [--timeout <s>] [--subscribe]
clawmini-lite.js delegations notify-when <id> [<id> ...] [--all]
clawmini-lite.js delegations unsubscribe <subscriptionId>
clawmini-lite.js delegations delete <id>
```

### `list`

Returns delegations in this chat. Default is `pending` + `running`. Pass
`--state resolved` (terminal) or a specific state (`completed`, `failed`,
`rejected`). `--kind subagent|policy` narrows by kind. `--json` prints raw
records.

From a subagent, `list` returns only **your** direct children (delegations
whose `parentId` is your subagent id). From the root agent it returns
root-spawned records.

### `show <id>`

Prints the full record for one delegation, including the `executionResult`
(for policies) once resolved.

### `wait <id> [<id> ...]`

Blocks the caller until the listed delegations satisfy the mode (default
`any` — fire on the first one to resolve; `--all` — fire when every id is
terminal). Prints `{resolved: [...], pending: [...]}` JSON. Default timeout
60s; `--timeout <seconds>` overrides.

Pass `--subscribe` (or use the `notify-when` alias) to register a
**subscription** instead: the call returns immediately with
`{subscriptionId: ...}`, and a single aggregated `<notification>` lands in
the chat when the mode is satisfied.

### `notify-when <id> [<id> ...] [--all]`

Alias for `wait --subscribe`. Returns a `subscriptionId` you can hand to
`unsubscribe`.

### `unsubscribe <subscriptionId>`

Cancels a subscription. Pending members revert to their declared delivery
mode (a `notify` member that resolves after `unsubscribe` will emit its own
per-id `<notification>`).

### `delete <id>`

Removes a delegation record. If the delegation is a running subagent, it is
also stopped. Refuses while any subscription still covers the id — call
`unsubscribe` first.

## Fan-Out Idiom

The cleanest way to dispatch N pieces of work and wait for all of them
without flooding your chat with per-id notifications:

```bash
# Create N delegations with `--delivery manual` so they don't notify
# individually:
ID_A=$(clawmini-lite.js subagents spawn --delivery manual "task A" | …)
ID_B=$(clawmini-lite.js subagents spawn --delivery manual "task B" | …)
ID_C=$(clawmini-lite.js subagents spawn --delivery manual "task C" | …)

# Register a single subscription that fires once after all three resolve:
clawmini-lite.js delegations notify-when "$ID_A" "$ID_B" "$ID_C" --all
```

When the last one finishes, **one** aggregated `<notification>` lands in
the chat summarising every resolved id (kind, state, reason for failures).

## Suppression Rule

If you have a `wait` or `notify-when` subscription covering an id, the
daemon **suppresses** that id's own `delivery: 'notify'` wakeup for that
resolution. This guarantees "exactly one wakeup, not N+1" when you fan out
over `notify`-mode delegations. After the observer fires (or is
`unsubscribe`d) the remaining `notify` members revert to their declared
delivery for future resolutions.

## Cross-References

- See `clawmini-subagents/SKILL.md` for the subagent creation surface
  (`subagents spawn`, `subagents send`, `subagents tail`, `subagents stop`).
- See `clawmini-requests/SKILL.md` for the policy request creation surface
  (`request <cmd>`, `manage-policies`, approvals).
- The kind-agnostic observation/cleanup primitives — `wait`, `list`,
  `show`, `notify-when`, `unsubscribe`, `delete` — all live in this skill.
