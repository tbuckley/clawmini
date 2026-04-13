# Questions regarding GChat Threads and Quote-Replies

1. **Replying Back to Threads:** The daemon treats everything in a `chatId` linearly and doesn't pass thread IDs back to the adapter. To route the agent's reply to the correct Google Chat thread, should the adapter track the `thread.name` of the *most recent* user message received on that `chatId` and route the next agent message to that thread? Or is there a different mechanism you envision for outbound routing?

2. **Fetching Context:** For both Quote-Replies and Threads, fetching the referenced/parent message requires an extra API call to Google Chat (`chatApi.spaces.messages.get` or `chatApi.spaces.messages.list`). Are you okay with the added latency and potential API quota usage for this?

3. **Quote-Replies vs Threads Context:** For a Quote-Reply, we will definitely quote the specific referenced message. For a regular Thread message, should we quote the *parent* message of the thread, the *immediately preceding* message in the thread, or just the parent? (Fetching the parent is usually 1 API call. Fetching the preceding might require listing messages).