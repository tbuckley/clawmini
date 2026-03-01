# Web Chat UX Improvements - Research Notes

## Current State

### Layout & Mobile Keyboard Issue
- Layout uses `h-svh` on the root provider (`web/src/routes/+layout.svelte`) and relies on `overflow-hidden` with a flex column for the main content area.
- The chat page (`web/src/routes/chats/[id]/+page.svelte`) is a flex column `h-full overflow-hidden`.
- The `app.html` viewport meta tag is standard: `<meta name="viewport" content="width=device-width, initial-scale=1" />`. This can cause issues on mobile where the virtual keyboard shifts the entire viewport upwards or resizes the layout incorrectly, hiding the header or text input.
- Using `interactive-widget=resizes-content` or utilizing visual viewport API might be necessary to keep both header and input visible.

### Data Fetching & Sync
- Messages are loaded via `+page.ts` initially, then updated via SSE (Server-Sent Events) in `setupSSE` inside `+page.svelte`.
- When navigating away, `onDestroy` closes the `eventSource`. When navigating back, the page re-fetches or uses cached SvelteKit data, which might not include messages received while away since the SSE was closed and the initial fetch data might be stale. SvelteKit `invalidate` is used but might be insufficient if SvelteKit decides not to re-run the load function or if the load function is cached. 
- There is no background sync or polling when the page is brought back from the background on mobile (visibilitychange events are not handled).

### Message Sending & Offline State
- `sendMessage` does a simple `fetch` to POST a message, then manually invalidates the SvelteKit load function (`app:chat:${data.id}`).
- If the fetch fails, the pending message is removed and the input is restored. There's no "failed to send" state kept in the UI or local storage.
- There is no offline queue. If you are on the subway and send a message, it just fails and returns the text to the input box.

## Desired Improvements
- Robust mobile keyboard layout (e.g., using `100dvh` properly or virtual viewport APIs).
- Better state persistence when navigating away and coming back (re-fetching the full thread on mount or visibility change).
- Offline message queue: save pending messages to local storage, show a "failed to send" or "offline" state, allow 1-tap resend.
- Ensuring connection reliability (reconnect SSE if dropped, sync missing messages).
