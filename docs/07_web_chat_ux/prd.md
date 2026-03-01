# Product Requirements Document: Web Chat UX Improvements

## Vision
To provide a best-in-class, robust, and reliable web chat experience for the Gemini CLI, particularly focused on mobile usability. The goal is to ensure users never feel like they are looking at stale data or fighting the interface to see their conversation, and that their interactions are preserved even in intermittent connectivity scenarios.

## Product / Market Background
Currently, the chat interface suffers from several reliability and layout issues, specifically on mobile devices.
- **Layout/Keyboard Issues:** When the virtual keyboard appears on mobile devices, the viewport changes unpredictably. This often causes both the header and the input area to be pushed out of view or overlapped, frustrating users who want to see the conversation history while typing.
- **Stale Data:** When navigating away from a chat and coming back, or backgrounding the tab, the server-sent events (SSE) connection is lost, and the user may be looking at a stale conversation without realizing new messages have arrived.
- **Offline Unreliability:** Sending a message without connectivity immediately drops the message and returns the text to the input box. Users in low-connectivity areas (e.g., subways) have to manually retype or copy/paste their message once reconnected.

To be a competitive chat client, we must solve these fundamental usability issues to match modern chat applications (e.g., iMessage, WhatsApp).

## Use Cases
1. **Typing on Mobile:** A user taps the input box on their phone. The keyboard appears, and the layout smoothly adjusts so that the input box sits directly above the keyboard, the header remains at the top, and the most recent messages are perfectly visible.
2. **Navigating Away and Returning:** A user asks a long-running question, navigates to a different chat or another app, and returns 5 minutes later. The chat instantly fetches the new messages that were generated in the background, updating the view seamlessly without a full page reload.
3. **Offline Messaging:** A user on a subway without cellular service types and sends a message. The message appears in the chat as "Pending/Offline" rather than failing completely. 
4. **Auto-resend & Deletion:** When the user regains cellular service, the pending message automatically sends. While offline, if the user decides the message is no longer relevant, they can delete the pending message from the queue before it sends.
5. **Manual Resend:** A user tapping a "Failed to Send" message has the option to force a manual retry.

## Requirements

### 1. Mobile Layout and Viewport
- **Dynamic Viewport Units:** Migrate from `h-svh` or standard `100vh` to viewport solutions that respect the virtual keyboard (e.g., `100dvh` or `interactive-widget=resizes-content` in the viewport meta tag).
- **Sticky Elements:** Ensure the chat header and the message input container are consistently anchored to the top and bottom of the visual viewport respectively.
- **Scroll Anchoring:** Maintain scroll position anchored to the bottom when new messages arrive or when the keyboard toggles, avoiding jarring jumps.

### 2. State Sync and Background Recovery
- **Delta Syncing:** When returning to a chat (via navigation or tab visibility change), automatically fetch only the new messages that arrived since the last known message ID (delta updates) to minimize payload and preserve UI state.
- **SSE Reliability:** Automatically attempt to reconnect the SSE stream if it drops unexpectedly, displaying a subtle "reconnecting..." indicator if the connection is lost for a noticeable duration.

### 3. Offline Message Queue
- **Local Storage / Persistence:** Store pending messages in local storage (or IndexedDB) immediately upon hitting "send", before attempting the network request.
- **UI States:** Introduce distinct visual states for messages:
  - *Sending (Spinner)*
  - *Offline / Pending (Grayed out with an icon indicating waiting for network)*
  - *Failed (Red error state with retry option)*
- **Offline Actions:** Allow users to tap/click an offline or failed message to show a menu with options to:
  - Delete the message (preventing it from sending later).
  - Retry sending manually.
- **Background Auto-Retry:** Listen for the browser's `online` event (`window.addEventListener('online', ...)`) and automatically attempt to send any pending messages in the queue once connectivity is restored.

## Security, Privacy, and Accessibility Concerns
- **Accessibility:** Ensure that dynamic layout changes (especially keyboard appearances) are announced correctly to screen readers if necessary. Offline and failed states must use clear iconography and have sufficient color contrast, rather than relying solely on color (e.g., don't just make it red, add an alert icon).
- **Privacy:** Pending messages will be stored locally on the user's device. For a web application, this means using `localStorage` or `IndexedDB`, which is accessible to anyone with access to the device/browser profile. Ensure sensitive data is not kept longer than necessary (e.g., clear the queue on successful sync or manual logout/clear data).
- **Security:** Ensure delta-sync fetching respects existing authentication and authorization scopes for the chat IDs.