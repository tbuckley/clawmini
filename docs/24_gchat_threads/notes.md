# Notes on GChat Threads and Quote-Replies

## Current State

- The daemon treats all messages linearly within a `chatId`.
- The Google Chat adapter drops `thread.name` when sending messages to the daemon.
- The Google Chat adapter does not pass `messageReplyOption` or `thread` when sending messages back to Google Chat, causing replies to appear as new top-level messages.
- The Discord adapter currently handles quote-replies by fetching the referenced message and prepending it as a markdown blockquote (`> ...`).

## Google Chat API Details

- **Quote Replies:** Google Chat API uses `quotedMessageMetadata` inside the `Message` object. This metadata usually contains the `name` of the quoted message, and maybe the `retagged` content or we can fetch the original message using `chatApi.spaces.messages.get`.
- **Threads:** Google Chat spaces can be threaded (in-line replies). Messages in a thread have `thread.name`. If a user replies in a thread, `threadReply` is true.

## Daemon Constraints

- Daemon represents conversations as a linear list of messages (`chatId`).
- To represent thread context to the daemon, we only have the `text`/`files` payload of the message.

## Possible Approaches for Threads

1.  **Blockquote the Thread Parent:** When a user replies in a thread, we can fetch the parent message of the thread (or the last message in the thread) and prepend it as a blockquote.
2.  **Thread ID Prefixing:** Prefix messages in a thread with something like `[Thread: <thread_id>]`.
3.  **Map Threads to Sub-Chats (Daemon side):** (Violates linear constraint, probably not ideal since we want simple text forwarding).
4.  **Implicit Context:** Do not modify the text sent to the daemon, but maintain a state mapping of `messageId -> thread.name` in the adapter. When the daemon replies to a message, how do we know which thread to put it in? The daemon doesn't tell us which message it's replying to; it just sends a new message to the `chatId`.

Wait, the prompt says: "For a thread, consider a few top approaches for how to represent the message then recommend one to pursue."
If the daemon is linear, and it replies linearly, the adapter needs a way to know *which* thread to reply to, OR it just replies to the most recently active thread, OR we pass thread info to the daemon? Wait, daemon doesn't have a concept of threads.
Wait! We could use a **Thread-to-Chat Mapping** approach. Just like we map Spaces to Chat IDs, we could map a Google Chat Thread to a unique Daemon Chat ID!
However, the prompt says: "Ultimately, we must forward a simple text/markdown message onto the daemon, which treats all messages as part of a linear conversation." This implies we are keeping them in the same `chatId`.

If we keep them in the same linear conversation, how does the bot reply to the correct thread?
If the bot just sends a message to the `chatId`, the adapter receives it. The adapter can look at the *last* user message it forwarded to the daemon for that `chatId`. If the last user message was in thread `A`, the adapter can send the bot's reply to thread `A`. This is **Stateful Last-Thread Tracking**.

Let's formulate the PRD and the questions.