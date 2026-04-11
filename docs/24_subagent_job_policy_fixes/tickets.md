# Tickets: Subagent Job and Policy Notification Fixes

## Ticket 1: Session Timeout Isolation
**Status:** not started
**Description:** Prevent the `session-timeout` router from scheduling a session timeout when processing messages from subagents.

**Tasks:**
1. Create an E2E test (e.g., in `test-workspace/` or `src/cli/e2e/session-timeout-subagents.test.ts` as appropriate) leveraging `clawmini-lite.js subagents spawn` to verify that when a subagent sends a message, no `__session_timeout__` cron job is scheduled.
2. Run the test and verify it fails (Red).
3. Update `src/daemon/routers/session-timeout.ts` to immediately return `state` without scheduling a timeout if `state.subagentId` is present.
4. Run the test and verify it passes (Green).

**Verification Steps:**
- The E2E test passes reliably.
- Run `npm run validate` to ensure all checks pass.

---

## Ticket 2: Policy Confirmation System Messages
**Status:** not started
**Description:** Ensure that when a user runs `/approve` or `/reject` for a subagent policy, a system message confirming the action is appended to the main chat log so the user gets UI feedback.

**Tasks:**
1. Create an E2E test verifying that upon `/approve` and `/reject` of a policy requested by a subagent, a system message (`role: 'system'`, `displayRole: 'agent'`) is appended to the main chat log with no `subagentId`.
2. Run the test and verify it fails (Red).
3. Update `src/daemon/routers/slash-policies.ts`:
   - For `/reject`: modify `userNotificationMsg` to remove the `subagentId` entirely.
   - For `/approve`: introduce a new `userNotificationMsg` (identical structure to the rejection notification but with the approval agent message) without `subagentId`, and append it to the chat.
4. Run the test and verify it passes (Green).

**Verification Steps:**
- The E2E test passes reliably.
- Run `npm run validate` to ensure all checks pass.

---

## Ticket 3: Subagent Policy Execution Routing Fix
**Status:** not started
**Description:** Fix the routing bug where policy execution results are incorrectly sent to the main agent instead of the requesting subagent.

**Tasks:**
1. Create an E2E test where a subagent requests a policy, and the user approves it. Validate that the subagent receives the execution result (stdout) and finishes its task, while the parent agent does *not* log any reaction to the policy execution result.
2. Run the test and verify it fails (Red) because the main agent incorrectly intercepts the policy result.
3. Update `handleUserMessage` in `src/daemon/message.ts` to pass `finalState.subagentId` as the 7th argument when calling `executeDirectMessage`.
4. Run the test and verify it passes (Green).

**Verification Steps:**
- The E2E test passes reliably.
- Run `npm run validate` to ensure all checks pass.
