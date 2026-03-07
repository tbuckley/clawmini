# Research Notes

## Daemon Side
- The `executeDirectMessage` function in `src/daemon/message.ts` is where the command is executed (`await runCommand(...)`). This operation can take a while (e.g., waiting for the AI agent to generate a response).
- We can introduce a `setInterval` before `runCommand` to periodically emit a `DAEMON_EVENT_HEARTBEAT` event on the `daemonEvents` emitter.
- After `runCommand` finishes, we clear the interval.
- The `router.ts` can expose a new tRPC subscription endpoint: `waitForTyping` which listens for `DAEMON_EVENT_HEARTBEAT`.

## Discord Adapter Side
- `src/adapter-discord/forwarder.ts` handles forwarding messages from the daemon to Discord.
- It uses a `waitForMessages` tRPC subscription.
- We can add a secondary subscription to `waitForTyping`.
- When a typing event is received, we fetch the DM channel and call `dm.sendTyping()`.
- Discord's `sendTyping()` lasts for 10 seconds. The daemon should emit heartbeats every ~5 seconds.

## Architecture Alternatives
- Instead of a separate subscription, we could multiplex heartbeats onto the `waitForMessages` stream by introducing a new `ChatMessage` role (e.g., `role: 'typing'`), and emitting `DAEMON_EVENT_MESSAGE_APPENDED` without actually saving to `chat.jsonl`.
- However, a separate subscription (`waitForTyping`) is cleaner because typing indicators are ephemeral UI state, not actual chat history.