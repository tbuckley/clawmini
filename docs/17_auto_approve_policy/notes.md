# Auto Approve Policy Feature Notes

## Current Architecture
- Policies are configured in `.clawmini/policies.json`.
- The CLI command `clawmini-lite request <cmd>` sends a TRPC mutation (`createPolicyRequest`) to the daemon.
- `createPolicyRequest` uses `PolicyRequestService` to snapshot files, create a request record with `state: 'Pending'`, and save it to the disk.
- A chat message is injected into the user's chat previewing the request and asking them to `/approve` or `/reject` it.
- When `/approve <id>` is executed in the chat (`slashPolicies` router), the daemon runs the command safely via `executeSafe`, marks the request as `Approved`, and injects the stdout/stderr into the chat as an agent message.

## Feature Requirements
- Users can mark a policy in `policies.json` as `autoApprove`.
- When an agent requests this policy, the request is automatically approved.
- No user prompt is generated (an FYI debug message may be sent).
- The result of the policy execution is shared with the agent.
- Future-proofing: Auto-approval may eventually be a script path that determines dynamically if it should approve/reject or leave it for manual review.

## Planned Changes
1. Update `PolicyDefinition` interface in `src/shared/policies.ts` to include `autoApprove?: boolean | string`.
2. Update `createPolicyRequest` in `src/daemon/api/agent-router.ts`:
   - Check if `policy.autoApprove` is true (or evaluates to true).
   - If auto-approved:
     - Log an FYI message to the chat (or system logs).
     - Execute the policy command immediately.
     - Save the request as `Approved`.
     - Share the result with the agent (either synchronously via CLI output or asynchronously via chat injection).
