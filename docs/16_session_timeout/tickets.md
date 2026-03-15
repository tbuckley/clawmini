# Session Timeout Feature Tickets

## Step 1: Extend `RouterState` Interface
**Objective:** Extend the `RouterState` interface to support dynamic job management and session rotation.
**Tasks:**
- Locate the `RouterState` definition (e.g., `src/daemon/routers/types.ts` or similar).
- Add `jobs?: { add?: CronJob[], remove?: string[] }` to `RouterState`.
- Add `nextSessionId?: string` to `RouterState`.
- Ensure any necessary types (like `CronJob`) are imported or defined.

**Verification:**
- Run `npm run validate` to ensure type checks and linting pass.

**Status:** complete

---

## Step 2: Update Daemon Message Pipeline
**Objective:** Modify the core message pipeline to handle the new `RouterState` properties.
**Tasks:**
- Modify `src/daemon/message.ts` (or the file responsible for executing the router pipeline).
- After pipeline execution, inspect `finalState.jobs`.
- For each job ID in `finalState.jobs.remove`, unschedule it using `cronManager.unscheduleJob(chatId, id)` and remove it from `chatSettings.jobs`.
- For each job in `finalState.jobs.add`, schedule it using `cronManager.scheduleJob(chatId, job)` and add/update it in `chatSettings.jobs`.
- Save the updated `chatSettings`.
- Update session assignment: use `finalState.nextSessionId` if available to set the active session for future messages (e.g., `chatSettings.sessions[currentAgentId] = finalState.nextSessionId`).

**Verification:**
- Add unit tests verifying that `jobs` returned by routers are correctly scheduled and unscheduled.
- Add unit tests verifying that `nextSessionId` successfully changes the active session for future messages without altering the current execution session.
- Run `npm run validate`.

**Status:** complete

---

## Step 3: Implement `@clawmini/session-timeout` Router
**Objective:** Create the stateless router that implements the session timeout logic.
**Tasks:**
- Create a new router module (e.g., `src/daemon/routers/session-timeout.ts`).
- Implement the router function accepting `state` and an optional config object (`{ timeoutMinutes?: number; prompt?: string }`).
- If the current message is the timeout execution (`state.env?.__SESSION_TIMEOUT__ === 'true'`), return state with `nextSessionId: crypto.randomUUID()` and `jobs: { remove: ['__session_timeout__'] }`.
- If it's a standard message, return state with a fresh timeout job added (`jobs.add`) and any existing one removed (`jobs.remove`).
- Use default values: 15 minutes for timeout and a generic expiration message for the prompt.

**Verification:**
- Add unit tests specifically for the `session-timeout` router logic, validating both the timeout execution branch and the standard message branch.
- Run `npm run validate`.

**Status:** not started
