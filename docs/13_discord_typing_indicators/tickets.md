# Discord Typing Indicators Tickets

## Ticket 1: Define Daemon Event
**Status**: Completed

**Description**:
Define the new `DAEMON_EVENT_TYPING` event string in the daemon's event definitions.

**Tasks**:
- Update `src/daemon/events.ts` to include a new `DAEMON_EVENT_TYPING` event constant.
- Define the payload type for this event, which must include at least the `chatId` (string).

**Verification**:
- Verify the code compiles without errors by running `npm run check`.
- Run all checks: `npm run format:check && npm run lint && npm run check && npm run test`.

## Ticket 2: Add tRPC Subscription Endpoint
**Status**: Completed

**Description**:
Expose a new `waitForTyping` subscription endpoint on the daemon's `AppRouter` to allow clients to listen for typing events.

**Tasks**:
- Update `src/daemon/router.ts` to add a `waitForTyping` subscription endpoint.
- The endpoint should filter internal `DAEMON_EVENT_TYPING` events by `chatId` and yield them to connected clients.

**Verification**:
- Add or update unit tests to verify the `waitForTyping` subscription yields events for the correct `chatId` (e.g., in `src/daemon/router.test.ts`).
- Run all checks: `npm run format:check && npm run lint && npm run check && npm run test`.

## Ticket 3: Emit Typing Events During Command Execution
**Status**: Completed

**Description**:
Update the daemon's message execution logic to periodically emit the typing event while a command is running.

**Tasks**:
- In `src/daemon/message.ts`, locate the `executeDirectMessage` function where `runCommand` is called.
- Before `runCommand` executes, set up a `setInterval` that emits the `DAEMON_EVENT_TYPING` event every 5000ms.
- Ensure the interval is cleared via `clearInterval` in a `finally` block to prevent orphaned intervals on both success and error.

**Verification**:
- Add or update tests to ensure the interval is set up and torn down correctly during command execution (e.g., in `src/daemon/message.test.ts` or `src/daemon/message-agent.test.ts`).
- Run all checks: `npm run format:check && npm run lint && npm run check && npm run test`.

## Ticket 4: Discord Adapter Integration
**Status**: Completed

**Description**:
Integrate the typing event subscription into the Discord adapter to provide visual feedback to users.

**Tasks**:
- Update `src/adapter-discord/forwarder.ts` to implement a `waitForTyping` subscription loop alongside the existing `waitForMessages` loop.
- Upon receiving a typing event for a chat, fetch the corresponding Discord DM channel using `client.users.fetch` and `user.createDM()`.
- Call `dm.sendTyping()` to display the indicator in Discord.
- Ensure potential errors from the `waitForTyping` subscription are handled gracefully with automatic retries and exponential backoff, identical to `waitForMessages`.

**Verification**:
- Add or update tests in `src/adapter-discord/forwarder.test.ts` to verify the new subscription loop acts as expected, errors are handled, and `dm.sendTyping` is triggered.
- Run all checks: `npm run format:check && npm run lint && npm run check && npm run test`.
