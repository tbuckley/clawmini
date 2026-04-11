# Product Requirements Document (PRD): Subagent Job & Policy Routing Fixes

## 1. Vision & Background
Subagents perform background tasks, execute tools, and handle nested workflows without cluttering the user's primary chat session. However, due to routing issues, subagents are currently triggering main-session side effects:
1. Messages from subagents trigger the `session-timeout` router, which inappropriately schedules session timeouts for subagents.
2. When a user approves or rejects a policy request created by a subagent, the resulting message is routed to the *parent* (main) agent rather than the subagent itself. This wakes up the parent agent incorrectly while leaving the subagent suspended without the result.
3. The confirmation messages generated during policy approval and rejection are improperly scoped, causing the user to miss out on the approval/rejection feedback in their main interface.

This feature resolves these workflow bugs, ensuring subagents handle their own policy resolutions and avoid main-session lifecycle events.

## 2. Use Cases
- **Subagent Background Execution:** A user runs a task that spawns a subagent. The subagent does not trigger a session-timeout prompt after completion.
- **Subagent Policy Approval:** A subagent requests a policy. The user approves it via `/approve`. The subagent receives the stdout/stderr, processes it, and finishes the task, while the parent agent remains unaffected.
- **User Feedback:** Upon running `/approve` or `/reject`, the user immediately sees a system notification in their main chat confirming the action.

## 3. Requirements

### 3.1. Session Timeout Isolation
- **Condition:** If an incoming message to the router pipeline contains a `subagentId`, the `session-timeout` router MUST ignore it.
- **Action:** Update `src/daemon/routers/session-timeout.ts` to instantly return `state` when `state.subagentId` is present.

### 3.2. Subagent Policy Execution Routing
- **Condition:** When a router (like `slash-policies`) returns a state containing a `subagentId`, the daemon must correctly route the execution of that state to the subagent.
- **Action:** Update `handleUserMessage` in `src/daemon/message.ts` to pass `finalState.subagentId` as the 7th argument (`subagentId`) to `executeDirectMessage`. This ensures the policy's result goes to the correct subagent session instead of defaulting to the main agent.

### 3.3. Policy Confirmation System Messages
- **Condition:** When a policy is approved or rejected, the user must receive a confirmation message in the main chat log. The message must NOT trigger a response from the parent agent.
- **Action:** Update `src/daemon/routers/slash-policies.ts`:
  - For **Reject**: Modify `userNotificationMsg` to remove the `subagentId` field entirely (so `subagentId` is effectively null/undefined). Ensure `role` is `'system'` and `displayRole` is `'agent'`.
  - For **Approve**: Introduce a new `userNotificationMsg` (identical in structure to the rejection one but with the approval `agentMessage`) and append it to the chat to notify the user. Ensure `subagentId` is not set on this notification.

## 4. E2E Testing Strategy

To verify these fixes, we will write explicit E2E tests leveraging the `debug` agent template and `clawmini-lite.js` to simulate subagents and policy requests.

1. **Session Timeout Subagent Test (e.g., in `cli/e2e/session-timeout.test.ts` or `cli/e2e/subagents.test.ts`):**
   - **Setup:** Initialize the workspace with the `session-timeout` router active (via `settings.json`) and a timeout interval of 1 hour. Add a `debug-agent` using the `debug` template.
   - **Action:**
     - Start a chat (`runCli(['chats', 'add', 'chat-timeout-sub'])`).
     - Send a message to the chat that spawns a subagent using the debug agent: `runCli(['messages', 'send', 'clawmini-lite.js subagents spawn --async "echo subagent-job-test"', '--chat', 'chat-timeout-sub', '--agent', 'debug-agent'])`.
   - **Verification:**
     - Wait for the subagent execution to complete (look for `[DEBUG] echo subagent-job-test:` in the `chat.jsonl`).
     - Inspect the chat's `settings.json` (or verify via `chat.jsonl`) to assert that **no** `__session_timeout__` cron job was scheduled as a result of the subagent's message.

2. **Policy Approval Routing Test (e.g., in `cli/e2e/subagents-policies.test.ts` or `cli/e2e/policies.test.ts`):**
   - **Setup:** 
     - Add a `debug-agent` and export `clawmini-lite.js`.
     - Define a custom policy in `policies.json` (e.g., `"test-policy": { "command": "echo", "args": ["policy executed"] }`).
   - **Action:**
     - Send a message that spawns a subagent which requests the policy: `clawmini-lite.js subagents spawn --async "clawmini-lite.js policies request test-policy"`.
     - Wait until the pending request appears (the subagent will be blocked waiting).
     - Have the *user* send the approval command in the main chat: `runCli(['messages', 'send', '/approve req-id', '--chat', '...'])`.
   - **Verification:**
     - Read the `chat.jsonl` to ensure that a `system` message confirming the approval (`Approved request, running test-policy`) was appended with `displayRole: 'agent'` and NO `subagentId` (making it visible to the user).
     - Wait for the subagent to finish. The `chat.jsonl` should contain `[DEBUG] ...` output from the subagent containing the execution result (`policy executed`), proving the subagent successfully awoke and received the policy result.
     - Ensure the parent main agent did NOT log any message reacting to the policy execution result (which would happen if the result was incorrectly routed to the main agent instead of the subagent).

## 5. Security & Privacy Concerns
No new security or privacy risks are introduced. This PRD corrects internal routing logic. By ensuring policy results only go to the subagent that requested them, this actually improves isolation between agents and subagents, enforcing better security boundaries.