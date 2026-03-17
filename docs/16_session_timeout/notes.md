# Session Timeout Feature Notes

## Objective
Implement an optional feature: After N minutes of inactivity in a chat, the current session is sent an automated message, and a new session is started for the user. Ideally, this leverages existing infrastructure.

## Existing Infrastructure
1. **Message Routers (`src/daemon/routers.ts`)**:
   - Every incoming message runs through a pipeline of routers.
   - Routers can change the session ID (e.g., `@clawmini/slash-new` creates a new session).
   - This approach is reactive (only triggers when the user sends a new message) and won't autonomously notify the user after N minutes of inactivity without a message prompt.

2. **Cron Manager (`src/daemon/cron.ts`)**:
   - A built-in job scheduler based on `node-schedule`.
   - Reads jobs from chat settings (`chatSettings.jobs`).
   - Supports `every: "10m"`, `cron: "* * * * *"`, and `at: "30m"` schedules.
   - Jobs can run `executeDirectMessage` to inject automated messages into the chat without user action.
   - Jobs can specify `session: { type: 'new' }` which generates a new `sessionId` (`crypto.randomUUID()`).

3. **Chat Persistence (`src/shared/chats.ts`)**:
   - Stores messages in `{chatId}/chat.jsonl`.
   - Each message has a `timestamp`.
   - Contains functions like `getMessages` and `appendMessage` which can be used to track the latest activity.

## Potential Approaches

### Approach 1: Leverage `CronManager` (Recommended)
We can use the existing `CronManager` and the `at` schedule type.
- **Trigger:** Whenever a user sends a message (or an agent replies), we schedule/reschedule a specific `session-timeout` job using `CronManager.scheduleJob`.
- **Job Configuration:** The job is configured with `at: "<N>m"`, `message: "Session expired due to inactivity."`, and `session: { type: 'new' }`.
- **Action:** If the user is inactive for N minutes, the job fires, the user receives the message, and their active session gets swapped to a new UUID. If the user replies before N minutes, the job is canceled and rescheduled for another N minutes.

### Approach 2: Global Daemon Tick Interval
- Create a global `setInterval` in the daemon (e.g. `src/daemon/index.ts`).
- Every 1 minute, it iterates through all active chats.
- It reads the last message from `getMessages(chatId, 1)`.
- If `Date.now() - new Date(lastMessage.timestamp) > N minutes`, it triggers `executeDirectMessage` and creates a new session.
- **Pros:** Doesn't require creating and destroying timeouts for every single message.
- **Cons:** Polling disk/files every minute for every chat can be slightly inefficient compared to in-memory `node-schedule`.

### Approach 3: Reactive Router
- A router like `@clawmini/session-timeout-router`.
- If the user sends a message, the router compares the current time with the last message's time.
- If difference > N, it forces `state.sessionId = 'new-session'` and prepends/appends an automated log message.
- **Cons:** Violates the requirement "After N minutes... the current session is sent an automated message" because it requires the user to send a message *first* before triggering the timeout logic. It is not autonomous.