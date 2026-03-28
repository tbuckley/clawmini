# Subagent Environment Policies Notes

## Current State
- `policies.json` contains a `policies` object mapping command names to `PolicyDefinition` (which has `command`, `args`, `allowHelp`, `autoApprove`).
- `PolicyRequest` is used for commands where an agent requests to run a sensitive command. It tracks the `state` ('Pending', 'Approved', 'Rejected').
- `subagentSpawn` and `subagentSend` currently execute immediately (or queued asynchronously) via `executeSubagent`.
- Subagents are tracked in chat settings `settings.subagents[id] = { status: 'active' | 'completed' | 'failed', ... }`.
- Environments are defined in `.clawmini/settings.json` and environments directory.

## Challenges to Address
1. **Storing the policy request to deliver the message later:**
   - Since `PolicyRequest` models requests as CLI commands, we will represent subagent requests as special pseudo-commands, such as `@clawmini/subagent_spawn` or `@clawmini/subagent_send`. 
   - The command's `args` can store the payload: `[targetAgentId, targetSubagentId, prompt]`. 
   - This prevents structural changes to the database while reusing the existing UI for policy approvals.
2. **Representing cross-env rules in policies.json:**
   - A user needs to configure auto-approval for specific environment boundaries (e.g., from `envA` to `envB`). 
   - We can embed the environment names directly into the pseudo-command to make standard `policies.json` filtering work out-of-the-box. For example: `@clawmini/subagent_send:envA:envB`.
   - Then users can define `{"command": "@clawmini/subagent_send:envA:envB", "autoApprove": true}` in `policies.json`.
3. **Handling internal execution flow:**
   - If `async` is false, `subagentSpawn` / `subagentSend` must block awaiting human approval (which changes the `PolicyRequest` state to Approved/Rejected).
   - If the request is rejected, the TRPC procedure will return a failed result or throw an error.
   - We need to be mindful of TRPC timeouts if the API endpoint blocks indefinitely.
