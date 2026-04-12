# Investigation Notes: Subagent Job and Policy Notification Fixes

## 1. Session-Timeout Subagent Bug
- **Issue**: The `session-timeout` router currently intercepts messages sent by subagents and schedules a session timeout job because it doesn't filter out messages with a `subagentId`.
- **Finding**: In `src/daemon/routers/session-timeout.ts`, the router checks `if (state.env?.__SESSION_TIMEOUT__ === 'true')` but ignores whether `state.subagentId` is present.
- **Fix**: The router should immediately return `state` without scheduling a timeout if `state.subagentId` is present.

## 2. Policy Approval/Rejection Routing Bug
- **Issue**: When a policy request (created by a subagent) is approved or rejected by the user, the result is sent to the *main agent* (the subagent's parent) rather than the subagent itself. 
- **Finding**: 
  - In `src/daemon/routers/slash-policies.ts`, `slashPolicies` correctly returns `subagentId: req.subagentId` in its updated `RouterState`.
  - However, in `src/daemon/message.ts`, the `handleUserMessage` function calls `executeDirectMessage` without passing `finalState.subagentId`.
  - Because `executeDirectMessage` receives `undefined` for `subagentId`, it routes the policy execution result to the main agent instead of the subagent.
- **Fix**: Update `handleUserMessage` in `src/daemon/message.ts` to pass `finalState.subagentId` as the 7th argument to `executeDirectMessage`.

## 3. Policy Confirmation Messages to the User
- **Issue**: The user needs UI confirmation of policy approval/rejection, but the current logic misroutes or omits these messages.
- **Finding**:
  - For `/reject`, `slash-policies.ts` creates a `userNotificationMsg` (with `role: 'system'` and `displayRole: 'agent'`), but it incorrectly sets `subagentId: req.subagentId`. This hides the confirmation from the main chat.
  - For `/approve`, no such `userNotificationMsg` is created at all; it only creates `logMsg` (with `displayRole: 'user'`) which is sent to the subagent's context.
- **Fix**: 
  - Ensure both `/approve` and `/reject` branches create a `userNotificationMsg` with `role: 'system'`, `displayRole: 'agent'`, and **no** `subagentId` (meaning it goes to the main chat for the user to see).
  - This ensures the confirmation goes to the user, while the actual execution result (routed via the fixed `handleUserMessage`) correctly wakes up the subagent, not the parent agent.

## E2E Tests
We need to provide e2e tests that verify these behaviors.
- A test for session-timeout ignoring subagent messages.
- A test for proposing a policy in a subagent, approving it, and verifying the subagent gets the result while the main agent does not.
