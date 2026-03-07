# Discord Typing Indicators (Heartbeat) PRD

## Vision
Improve the user experience in the Discord adapter by providing visual feedback when an AI agent is processing a request. By leveraging Discord's native "typing" indicator, users will clearly see that the daemon is working on their command and has not stalled, even during long-running LLM inferences or background operations.

## Background
Currently, when a user sends a message to the Clawmini daemon via Discord, there can be a significant delay between the user's message and the agent's response, especially for complex tasks. Without any visual feedback during this delay, users might assume the command was lost or the bot crashed. Discord supports a `sendTyping()` API for channels/DMs, which displays a "Bot is typing..." indicator for up to 10 seconds. To maintain the typing indicator for longer commands, the bot needs to continuously emit this signal.

## Use Cases
*   **Long-Running Commands:** A user asks the agent to perform an extensive codebase search and refactoring task. The Discord bot displays the typing indicator for the entire 30+ seconds it takes the daemon to respond, reassuring the user.
*   **Preventing Double Inputs:** Seeing the typing indicator discourages users from repeatedly sending the same command or asking "are you there?".

## Requirements

### 1. Daemon Event Emission
*   The daemon must emit a `DAEMON_EVENT_HEARTBEAT` (or similar) internal event while a command is actively running.
*   In `src/daemon/message.ts` (specifically around `executeDirectMessage` where `runCommand` is called), an interval should be established to emit this heartbeat event every ~5 seconds.
*   The interval MUST be reliably cleared once the command execution finishes (both on success and error).
*   The heartbeat event payload must include at least the `chatId`.

### 2. tRPC Subscription Endpoint
*   The daemon's `AppRouter` (`src/daemon/router.ts`) must expose a new `waitForTyping` subscription endpoint.
*   This endpoint will listen to the internal `daemonEvents` for the `DAEMON_EVENT_HEARTBEAT` event.
*   It should filter events by `chatId` (similar to the existing `waitForMessages` endpoint) and yield to connected clients.

### 3. Discord Adapter Integration
*   The Discord forwarder (`src/adapter-discord/forwarder.ts`) must subscribe to the new `waitForTyping` endpoint.
*   Upon receiving a typing event for an active chat, the adapter must fetch the corresponding Discord DM channel (using `client.users.fetch` and `user.createDM()`).
*   The adapter must call `dm.sendTyping()`.
*   The forwarder must handle potential errors from the `waitForTyping` subscription, similar to how it handles the `waitForMessages` stream, implementing automatic retries with exponential backoff if the connection drops.

## Non-Functional Requirements
*   **Performance:** The interval and additional local SSE connection must have a negligible footprint.
*   **Reliability:** The interval in the daemon must be properly cleaned up in a `finally` block or similar mechanism to prevent orphaned intervals from leaking memory or causing phantom typing indicators.
*   **Backwards Compatibility:** Existing clients (CLI, Web interface) must not be negatively impacted by this new feature. The separation of the typing stream from the `waitForMessages` stream guarantees that the persistent message model remains intact.

## Implementation Steps
1.  **Daemon Events (`src/daemon/events.ts`):** Define the new `DAEMON_EVENT_TYPING` event string.
2.  **Daemon Message Logic (`src/daemon/message.ts`):** Wrap the `runCommand` execution in `executeDirectMessage` with a `setInterval` that emits the typing event every 5000ms. Ensure the interval is cleared via `clearInterval` when the command concludes.
3.  **tRPC Router (`src/daemon/router.ts`):** Add the `waitForTyping` subscription endpoint to the `AppRouter`.
4.  **Discord Adapter (`src/adapter-discord/forwarder.ts`):** Implement the `waitForTyping` subscription loop alongside the existing `waitForMessages` loop, triggering `dm.sendTyping()` when an event is received.