# Questions
## Question 1
Q: How would you prefer the typing heartbeat to be transmitted over tRPC?
- Option A: Add a new `waitForTyping` subscription endpoint specifically for typing events. This clearly separates persistent messages from ephemeral UI state but requires clients to open an additional subscription.
- Option B: Introduce a temporary message type (e.g., `{ role: 'typing' }`) that gets emitted via the existing `waitForMessages` subscription (but isn't saved to the chat's JSONL file). This avoids a second subscription connection but mixes UI state into the chat model.
Recommendation: Option A is recommended. It keeps the persistent `ChatMessage` types pure and avoids unexpectedly breaking existing clients (like the CLI) that expect all incoming messages from `waitForMessages` to be saveable, renderable chat logs. Creating an additional SSE connection over the local Unix socket is very lightweight.
