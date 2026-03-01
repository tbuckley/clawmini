# Development Log

## Ticket 1: Mobile Layout and Viewport Optimization
- Started work on Ticket 1. Checking `app.html` and layout files for viewport issues.
- Added `interactive-widget=resizes-content` to `app.html` viewport meta tag.
- Replaced `h-svh` with dynamic viewport unit `h-[100dvh]` in main layout `+layout.svelte`.
- Implemented `ResizeObserver` / `visualViewport` event listeners in `chats/[id]/+page.svelte` to ensure the chat stays anchored to the bottom when the virtual keyboard toggles.
- Ran all project checks and tests; everything passed.

## Ticket 2: State Sync and Background Recovery
- Implemented delta message fetching by updating `GET /api/chats/:id` in `src/cli/commands/web-api/chats.ts` to support the `?since=msgId` query parameter.
- Refactored `setupSSE` in `web/src/routes/chats/[id]/+page.svelte` to use a `reconnectTimeout` and set `isReconnecting` state on SSE failure. 
- Created a `fetchDeltaMessages` function that retrieves new messages and merges them into `liveMessages`.
- Added a `visibilitychange` listener to auto-fetch deltas and reconnect the stream when the tab becomes active again.
- Added a subtle floating indicator `Reconnecting...` when `isReconnecting` is true.
- Ran formatting, linting, and all checks from the root directory; everything passed successfully.

## Ticket 3: Offline Message Queue - Persistence & UI
- Modified message sending logic in `web/src/routes/chats/[id]/+page.svelte` to use `localStorage` for pending messages.
- Added UI states (`sending`, `pending`, `failed`) with `lucide-svelte` icons.
- Handled network checks to set correct status before fetching.
- Ran all checks and tests successfully.
