# Web Chat UX Improvements Tickets

## Ticket 1: Mobile Layout and Viewport Optimization
**Description:** Fix layout issues caused by the virtual keyboard on mobile devices. Ensure the chat header and input remain visible and correctly anchored.
**Tasks:**
- Update `web/src/app.html` viewport meta tag to handle `interactive-widget=resizes-content` if appropriate, or adjust layout components.
- Refactor layout in `web/src/routes/+layout.svelte` and `web/src/routes/chats/[id]/+page.svelte` to use dynamic viewport units (`100dvh` instead of `h-svh` or standard `100vh`).
- Implement scroll anchoring to ensure the chat stays scrolled to the bottom when new messages arrive or the keyboard toggles.
**Verification:** 
- Run `npm run format:check && npm run lint && npm run check && npm run test` from the `web/` directory.
- Manually test input focus and keyboard appearance on a mobile device or simulator to ensure header and input remain fully visible.
**Status:** complete

## Ticket 2: State Sync and Background Recovery
**Description:** Ensure chat data remains fresh when the user navigates away and returns, or when the connection drops.
**Tasks:**
- Add a `visibilitychange` event listener in the chat page to detect when the tab becomes visible again.
- Implement delta syncing to fetch only new messages (since the last known message ID) upon tab return or SSE reconnect.
- Update SSE logic in `setupSSE` to automatically attempt reconnection if the stream drops unexpectedly.
- Add a subtle "reconnecting..." UI indicator when the SSE connection is lost.
**Verification:**
- Run `npm run format:check && npm run lint && npm run check && npm run test` from the `web/` directory.
- Simulate network disconnects and backgrounding the tab to verify SSE reconnection and delta message fetching.
**Status:** complete

## Ticket 3: Offline Message Queue - Persistence & UI
**Description:** Implement the foundational logic for sending messages while offline and displaying their status.
**Tasks:**
- Modify the message sending logic to store pending messages in `localStorage` immediately upon hitting "send", before the network request.
- Introduce distinct UI states for messages in the chat view: Sending (Spinner), Offline / Pending (Grayed out with an icon), and Failed (Red error state with an alert icon).
- Render pending messages from `localStorage` inline with the actual chat history.
**Verification:**
- Run `npm run format:check && npm run lint && npm run check && npm run test` from the `web/` directory.
- Send a message while offline (using browser dev tools) and verify it appears in the chat with the "Offline / Pending" state and is persisted across page reloads.
**Status:** complete

## Ticket 4: Offline Message Queue - Actions & Auto-Retry
**Description:** Implement automatic and manual recovery mechanisms for offline messages.
**Tasks:**
- Listen for the browser's `online` event (`window.addEventListener('online', ...)`) to automatically attempt resending pending messages in the queue.
- Implement a tap/click action on offline/failed messages to reveal a menu.
- Add "Retry manual send" option to the menu.
- Add "Delete message" option to the menu to remove it from the pending queue before it sends.
**Verification:**
- Run `npm run format:check && npm run lint && npm run check && npm run test` from the `web/` directory.
- Test sending offline, then coming online to verify automatic retry.
- Test manual retry and deletion of a pending message.
**Status:** complete