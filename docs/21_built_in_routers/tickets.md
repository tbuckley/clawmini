# Development Tickets

## Milestone 1: Router Pipeline Refactoring

**Description:** Refactor the router execution pipeline to distinguish between `GLOBAL_ROUTERS` and `USER_ROUTERS` (which apply only to direct user inputs). Any additional routers the user specifies should ONLY apply to user messages to the agent. Update message ingestion points to utilize the appropriate router pipelines. Note that routers should only apply to: (1) messages from the user to an agent, (2) messages from a job to an agent, and (3) messages from an agent to a subagent. Filter out any `@clawmini/*` routers provided by the user to avoid double execution while extracting their configurations if applicable.

**Verification:**

1. Unit tests pass (especially tests in `src/daemon/routers.test.ts`, `src/daemon/message.test.ts`, and `src/daemon/cron.test.ts`).
2. Run `npm run validate` and verify all tests and type checks pass.

**Status:** Complete

---

## Milestone 2: Fix Session Timeout Logic

**Description:** Update the `@clawmini/session-timeout` router implementation to ensure correct functioning across multiple sessions. Append the current `sessionId` to the cron job ID to ensure it is unique per session. Also, attach the current `sessionId` inside the job's `session: { type: 'existing', id: sessionId }` payload, so the cron job runs correctly bound to the session it originated from. Ensure it correctly cleans up existing timeout jobs for the given session. Also, update the default message to specify that the agent should respond with `NO_REPLY_NECESSARY` when done.

**Verification:**

1. Update and verify unit tests in `src/daemon/routers/session-timeout.test.ts`.
2. Run `npm run validate` and verify all tests and type checks pass.

**Status:** Complete
