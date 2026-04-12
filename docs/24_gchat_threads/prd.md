# Product Requirements Document: Google Chat & Discord Quote-Replies and Threads Support

## Vision
To enhance both the Google Chat and Discord adapters' conversational awareness by enabling them to understand context from quote-replies and in-line threads, and to reply seamlessly within those structures. The logic should be kept as close as possible across both platforms.

## Product/Market Background
Currently, the Google Chat adapter operates sequentially at the Space level, breaking user threads when it replies. The Discord adapter supports quote-reply ingestion (by fetching the referenced message) but does not visually reply back using Discord's native reply feature. Both adapters need a unified way to process threads and visually respond to specific messages or threads.

Supporting quote-replies and threads is essential for a natural user experience, allowing conversations to stay organized and contextualized.

## Use Cases
1. **Quote-Replies:** A user highlights a specific previous message from the bot or another user and selects "Quote in reply" (Google Chat) or "Reply" (Discord) to ask a follow-up question. The bot should understand exactly which message is being referenced and visually reply to it.
2. **In-Line Threads:** A user replies to an existing message using Google Chat's "Reply in thread" or Discord's Thread feature. The bot should interpret this message with the context of the thread and post its response back into that same thread.

## Requirements

### 1. Ingestion & Context Fetching (Quote-Replies and Threads)
When forwarding messages to the daemon, the adapters must provide context for quote-replies and threads by fetching the relevant message and prepending it as a markdown blockquote (`> [Quoted/Previous Message Text]\n\nUser Message`).

- **Quote-Replies:** 
  - **Google Chat:** Detect `quotedMessageMetadata` in incoming messages. Fetch the specific quoted message content and prepend it.
  - **Discord:** (Already partially implemented) Detect `message.reference.messageId`. Fetch the message and prepend it.
- **Threads:** 
  - **Google Chat:** Detect `threadReply: true`. Fetch the *immediately preceding* message in the thread and prepend it as a blockquote.
  - **Discord:** Detect if `message.channel.isThread()` is true. Fetch the *immediately preceding* message in the thread and prepend it.
- *Note:* Extra API calls are acceptable for these specific scenarios. Handle rate-limits and network failures gracefully.

### 2. Outbound Routing via `adapterMessageId`
To enable the daemon to indicate which user message it is responding to, we will introduce a new correlation ID mechanism in the shared schema:

- **Schema Update:** Add an `adapterMessageId?: string` property to the `UserMessage` interface in `src/shared/chats.ts`.
- **Response Correlation:** Update `AgentReplyMessage` (and other relevant response types) to support a `messageId?: string` property. When the daemon or an agent generates a response to a user message, it should set `messageId` to the value of the `adapterMessageId` from that user message.
- **Adapter Ingestion:** 
  - **Google Chat:** Set `adapterMessageId` to the incoming Google Chat message name. Maintain a local state mapping of `adapterMessageId -> thread.name`.
  - **Discord:** Set `adapterMessageId` to the incoming Discord message ID. Maintain a local state mapping of `adapterMessageId -> { channelId, messageId }`.
- **Adapter Forwarding:** When an adapter receives an `AgentReplyMessage` from the daemon, it will check the `messageId` field.
  - **Google Chat:** Look up `thread.name` from the mapping. If found, append `thread: { name: <thread.name> }` to the `spaces.messages.create` request.
  - **Discord:** Look up the `{ channelId, messageId }` from the mapping. If found, send the message to that `channelId` using Discord's `reply: { messageReference: messageId }` option.

### Technical Tasks
1. Update `src/shared/chats.ts` to add `adapterMessageId` to `UserMessage` and ensure `AgentReplyMessage` supports `messageId`.
2. Update `src/daemon/api/index.ts` (or the relevant routing/agent logic) to propagate the `adapterMessageId` from the last user message into the `messageId` of the outgoing agent replies.
3. Update `client.ts` in the Google Chat adapter:
   - Handle `quotedMessageMetadata` and `threadReply: true` by fetching context via the Google Chat API.
   - Format the payload with markdown blockquotes.
   - Set `adapterMessageId` to the Google Chat message name and store the mapping to `thread.name`.
4. Update `forwarder.ts` in the Google Chat adapter:
   - Use the mapped `thread.name` to include the thread parameter in the Google Chat API call.
5. Update `index.ts` in the Discord adapter:
   - Enhance thread ingestion by checking `message.channel.isThread()` and fetching the preceding message.
   - Set `adapterMessageId` to `message.id` and store the mapping to `{ channelId: message.channelId, messageId: message.id }`.
6. Update `forwarder.ts` in the Discord adapter:
   - Use the mapped `messageId` and `channelId` to pass `reply: { messageReference: messageId }` when sending the message.

## Privacy & Security
- Ensure that fetching quoted messages or previous thread messages respects standard authorization boundaries across both platforms.

## Performance & Accessibility
- **Performance:** Handle API rate-limits and network failures gracefully when fetching context. If the fetch fails, forward the user message without the quote to avoid dropping the message entirely. Limit state mapping size to prevent unbounded memory growth.