# Google Chat Adapter Notes

## Current Architecture (based on adapter-discord)
- Adapters are standalone Node.js scripts executed separately from the main daemon.
- They communicate with the Clawmini daemon via a local Unix socket using tRPC (`getTRPCClient()`).
- Incoming messages are passed to the daemon via `trpc.sendMessage.mutate()`, providing the message content, files, chat ID, and the adapter name (`adapter: 'google-chat'`).
- The adapter forwards outgoing messages from the daemon by subscribing to `trpc.waitForMessages.subscribe()`. It tracks the `lastSyncedMessageId` in a local state file (e.g., `state.json`) to avoid resending past messages on restart.
- For Discord, `chatId` is configured in `config.json` and a specific `authorizedUserId` is enforced. Attachments are downloaded temporarily and their local paths are sent to the daemon.

## Google Chat Integration Details
- **Receiving Messages:** The user specified receiving messages via Google Cloud Pub/Sub. This requires the `@google-cloud/pubsub` dependency. The bot's endpoint in the Google Chat API configuration must be set to "Cloud Pub/Sub" and bound to a specific topic/subscription.
- **Sending Messages:** The adapter needs to send messages via the Google Chat API (`googleapis` dependency). It will call `spaces.messages.create`.
- **Authentication:** Typically requires a Google Cloud Service Account with the Google Chat API enabled. The credentials are used to instantiate both the Pub/Sub client and the Chat API client.

## Requirements for adapter-google-chat
- A new folder `src/adapter-google-chat` mirroring `src/adapter-discord`.
- `config.ts`: Reads config like `serviceAccountPath`, `pubsubSubscriptionName`, `projectId`, `authorizedSpaces` or `authorizedUsers`.
- `index.ts`: Initializes the Pub/Sub listener, maps incoming events to `sendMessage.mutate`.
- `forwarder.ts`: Subscribes to daemon messages, uses Google Chat API to reply to the correct space/thread.
- Package dependencies: `@google-cloud/pubsub`, `google-auth-library` or `googleapis`.

## Top-level replies instead of threaded replies
- The user requested that AI replies should be top-level messages, not threaded responses to the user's message.
- Currently, `src/adapter-google-chat/active-thread.ts` stores the `activeThreadName` and `src/adapter-google-chat/forwarder.ts` uses it to set the `thread` field and `messageReplyOption` when creating the message via the Google Chat API.
- Also, `src/adapter-google-chat/client.ts` sets the `activeThread` when an event is received.
- To implement top-level messages, we should stop setting the `thread` property on outgoing messages in `forwarder.ts`. The message should just be sent to the `spaceName`.
- `messageReplyOption: 'REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD'` should be removed as it only matters if a thread is specified.
- The `activeThreadName` state tracking in `active-thread.ts` might become redundant if we never reply in threads. We should remove it or ignore it for replies.