# Implementation Tickets: Google Chat & Discord Quote-Replies and Threads

## Ticket 1: Shared Schema Updates
**Description:** Add `adapterMessageId` to the shared message schemas to allow correlation between incoming user messages and outgoing bot replies.
**Tasks:**
- Update `src/shared/chats.ts` to add `adapterMessageId?: string` to `UserMessage`.
- Ensure `AgentReplyMessage` (and any other outgoing message types like `SystemMessage` that might respond to user actions) supports `messageId?: string`.
**Verification:**
- Run `npm run validate` to ensure TypeScript compilation passes.
**Status:** Not started

## Ticket 2: Daemon State Propagation
**Description:** Update the daemon's internal state management or routing to remember the `adapterMessageId` associated with the current conversation turn, and propagate it to outgoing replies.
**Tasks:**
- Locate where user messages are processed and agent replies are generated (likely in `src/daemon/api/index.ts` or `src/daemon/`).
- Store the incoming `UserMessage.adapterMessageId` on the conversation state or pass it through the agent run loop.
- When emitting an `AgentReplyMessage`, attach the saved `adapterMessageId` as the `messageId`.
**Verification:**
- Write or update a unit test demonstrating that when a `UserMessage` with an `adapterMessageId` is received, the resulting `AgentReplyMessage` contains the identical `messageId`.
- Run `npm run validate`.
**Status:** Not started

## Ticket 3: Google Chat Adapter Ingestion & Mapping State
**Description:** Enhance Google Chat ingestion to handle quote-replies and threads by fetching referenced context, prepending it as a blockquote, and mapping IDs.
**Tasks:**
- Update `src/adapter-google-chat/client.ts` to detect `quotedMessageMetadata` and `threadReply: true`.
- Fetch the referenced context via the Google Chat API.
- Prepend the referenced text to the payload as a markdown blockquote (`> ...`).
- Set `adapterMessageId` on the forwarded message to the Google Chat message `name`.
- Maintain an LRU cache or Map for `adapterMessageId -> thread.name`.
- Handle rate-limit and missing message scenarios gracefully (i.e., proceed without the blockquote instead of crashing).
**Verification:**
- Write or update unit tests mocking the Google Chat API responses to verify that `adapterMessageId` is correctly populated and blockquotes are appropriately formatted.
- Run `npm run validate`.
**Status:** Not started

## Ticket 4: Google Chat Adapter Outbound Threading
**Description:** Ensure that bot replies in Google Chat map to the correct thread if the user's message was in a thread.
**Tasks:**
- Update `src/adapter-google-chat/forwarder.ts` to inspect the `messageId` on an incoming `AgentReplyMessage`.
- Look up the `messageId` (which corresponds to `adapterMessageId`) in the local state mapping.
- If a mapped `thread.name` is found, append `thread: { name: <thread.name> }` to the `spaces.messages.create` request.
**Verification:**
- Write or update unit tests for the forwarder to ensure that the outbound API call includes the thread object when a mapping exists.
- Run `npm run validate`.
**Status:** Not started

## Ticket 5: Discord Adapter Ingestion & Mapping State
**Description:** Enhance Discord message ingestion to handle threads and quote-replies, and map IDs.
**Tasks:**
- Update `src/adapter-discord/index.ts` (or relevant ingestion client) to check if `message.channel.isThread()` is true and fetch the immediately preceding message in the thread.
- Retain existing quote-reply detection (via `message.reference.messageId`) but ensure both populate a markdown blockquote in the text.
- Forward the message to the daemon with `adapterMessageId: message.id`.
- Maintain a local state mapping of `adapterMessageId -> { channelId: message.channelId, messageId: message.id }`.
**Verification:**
- Write or update unit tests for Discord ingestion to verify that `adapterMessageId` and the blockquote logic works correctly for threads.
- Run `npm run validate`.
**Status:** Not started

## Ticket 6: Discord Adapter Outbound Replies
**Description:** Ensure that bot replies in Discord visually reply to the specific message or thread using Discord's native reply feature.
**Tasks:**
- Update `src/adapter-discord/forwarder.ts` to inspect the `messageId` on an incoming `AgentReplyMessage`.
- Look up the `messageId` in the local state mapping.
- If mapped, send the outgoing message to the mapped `channelId` and configure Discord's message options with `reply: { messageReference: <mapped messageId> }`.
**Verification:**
- Write or update unit tests for the Discord forwarder to verify that the `reply` object is passed to Discord's messaging API when a mapping exists.
- Run `npm run validate`.
**Status:** Not started