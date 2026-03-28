# Built-in Routers & Session Timeout Enhancement Notes

## Current State

### Routers
- **Defined via Settings:** Routers are currently defined in user `~/.gemini/settings.json` or `settings.json` in the workspace/chat.
- **Execution Flow:** `handleUserMessage` (in `src/daemon/message.ts`) runs `executeRouterPipeline`, applies state updates (`applyRouterStateUpdates`), and calls `executeDirectMessage`.
- **Jobs Bypass:** `cron.ts` currently bypasses the router pipeline. It constructs its own `routerState` from `getInitialRouterState` and explicitly updates it from the job config before directly invoking `executeDirectMessage`.
- **Built-in Handling:** `src/daemon/routers.ts` explicitly matches strings starting with `@clawmini/` to determine which built-in function to call (e.g. `@clawmini/session-timeout`, `@clawmini/slash-command`).
- **Agents:** Currently, agent messages do not run through routers. We want GLOBAL_ROUTERS to apply to *all* messages, including agent messages.

### Session Timeout Issue
- **Per-Chat vs. Per-Session:** The current `session-timeout.ts` router blindly adds a cron job named `__session_timeout__` to the chat.
- **Multiple Sessions Bug:** If a user creates a new session (e.g., via `/new`), the previous session never receives the timeout prompt because there is only one `__session_timeout__` job ID per chat, or it simply isn't tied to the session.
- **Jobs:** If a job runs in its own session, the timeout logic is also broken.
- **Proposed Solution:**
  1. Append the session ID to the job ID to make it unique per session (e.g., `__session_timeout__<sessionId>`).
  2. The job itself should preserve the session ID so the timeout prompt executes in the correct session context.
  3. We must pass jobs through the router pipeline so `session-timeout` and other routers can operate on them.

## Proposed Architecture
- Introduce `USER_ROUTERS` (only applied to user messages).
- Introduce `GLOBAL_ROUTERS` (applied to all messages: user, job, agent).
- Migrate `@clawmini/session-timeout` to a global built-in router.
- When applying routers, prepend the built-in routers to the ones retrieved from user configuration.
- Deprecate or gracefully ignore `@clawmini/*` strings inside user configs since they'll be globally applied anyway.
- Jobs (`cron.ts`) and Agent replies will need to invoke `executeRouterPipeline` (or a variant for global routers) before executing.
