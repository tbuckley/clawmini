# Notes for WebUI Markdown Rendering

## Current Implementation

### WebUI Message Handling
- Messages are rendered in `web/src/routes/chats/[id]/+page.svelte`.
- They are fetched initially via SvelteKit load function `web/src/routes/chats/[id]/+page.ts` calling `/api/chats/[id]`.
- Live updates are handled via SSE `/api/chats/[id]/stream`.
- Delta fetching (when tab becomes visible) uses `/api/chats/[id]?since=[lastMsgId]`.
- Messages are just simple strings currently (`<div class="whitespace-pre-wrap">{msg.content}</div>`).
- There is a verbosity filter that hides/shows log messages vs user messages.

### API
- The API is served by the `cli` module (`src/cli/commands/web-api/chats.ts`).
- It proxies `/api/chats/...` requests.
- Currently, I need to investigate if `GET /api/chats/[id]` supports pagination (`limit`, `before`) or just fetches all messages.

## PRD Requirements
1. Add markdown rendering support to messages in the webui.
2. Add an option to toggle markdown rendering on/off.
3. Keep performance reasonable.
4. Load only the most recent ~100 messages by default.
5. Provide a button to "Load previous 100" when scrolling back through history.
