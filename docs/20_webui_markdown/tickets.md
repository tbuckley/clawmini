# Tickets: WebUI Markdown Rendering & Pagination

## Ticket 1: API Message Pagination
**Description**: Update the backend to support fetching a limited window of messages. 
- Modify `getMessages` in `src/shared/chats.ts` to efficiently return a subset of messages based on `limit` and `before` cursor (message ID).
- Update the `GET /api/chats/[id]` route handler in `src/cli/commands/web-api/chats.ts` (or equivalent location) to accept `limit` and `before` query parameters.
- Ensure the default behavior loads at most 100 messages if no limit is provided.
**Verification**:
- Add unit/integration tests to verify pagination logic for `getMessages` and the API route.
- Run `npm run validate` to ensure all checks pass (`npm run format`, `npm run lint`, etc.).
**Status**: complete

## Ticket 2: Frontend Markdown Rendering 
**Description**: Introduce Markdown rendering in the Svelte frontend.
- Install `marked` (and its types) and a sanitization library (like `dompurify` or `isomorphic-dompurify`) into the `web` workspace.
- Create a reusable Svelte component (e.g., `MarkdownRenderer.svelte`) to parse and safely render Markdown content to HTML.
- Update `web/src/routes/chats/[id]/+page.svelte` to use this component for user and agent messages instead of plain text.
**Verification**:
- Write frontend unit tests for the `MarkdownRenderer` component to verify successful rendering and XSS sanitization.
- Run `npm run test -w web` and `npm run check -w web`.
- Run `npm run validate` from the root workspace.
**Status**: complete

## Ticket 3: Global Markdown Toggle Setting
**Description**: Add a global setting to enable/disable Markdown rendering.
- Add a `markdownEnabled` property to the global `appState` (persisted in local storage/workspace settings).
- Add a UI toggle for this setting, accessible via the UI header.
- Connect the toggle to the Markdown rendering logic in `+page.svelte` so it conditionally renders plain text when disabled.
**Verification**:
- Verify through tests or workspace verification that the `appState` correctly toggles and persists.
- Run `npm run validate` from the root workspace.
**Status**: complete

## Ticket 4: Frontend Pagination UI
**Description**: Implement the "Load previous messages" UI and fetching logic.
- Add a "Load previous messages..." button at the top of the chat container in `web/src/routes/chats/[id]/+page.svelte`.
- Implement fetching logic to call `GET /api/chats/[id]?limit=100&before=[oldestMessageId]` when the button is clicked.
- Prepend the fetched messages to the UI's current list and ensure the user's scroll position is maintained visually (prevent jarring jumps to the top).
**Verification**:
- Ensure all E2E or component tests pass for the new fetching logic.
- Run `npm run test -w web` and `npm run check -w web`.
- Run `npm run validate` from the root workspace.
**Status**: complete

## Ticket 5: Missing Pagination UI Button (High Priority)
**Description**: The `loadPreviousMessages` function was added to `web/src/routes/chats/[id]/+page.svelte` but it is never called. A "Load previous messages..." button needs to be added to the top of the chat container to allow users to trigger it.
**Status**: complete

## Ticket 6: API Limit Parsing NaN Bug (Medium Priority)
**Description**: In `src/cli/commands/web-api/chats.ts`, `limitParam` is parsed using `parseInt(limitParam, 10)` without checking for `NaN`. If a non-numeric string is provided, `NaN` is passed to `getMessages()`, which breaks the loop termination condition and causes the entire chat history file to be read instead of failing or using the default limit.
**Status**: complete

## Ticket 7: DRY Violation in Markdown Rendering (Low Priority)
**Description**: The logic for conditionally rendering `<MarkdownRenderer>` or `<div class="whitespace-pre-wrap">` based on `appState.markdownEnabled` is duplicated three times in `web/src/routes/chats/[id]/+page.svelte`. This should be extracted into a Svelte 5 `#snippet` to improve maintainability and DRY compliance.
**Status**: complete