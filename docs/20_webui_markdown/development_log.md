# Development Log

## Ticket 1: API Message Pagination
- Started working on API message pagination.
- Updated `getMessages` to accept `limit` and `before` parameters.
- Default limit is 100.
- Updated API endpoint `/api/chats/[id]` to parse `limit` and `before`.
- Fixed strict null checks in `chats.test.ts`.
- Added API pagination test to `daemon.test.ts`.
- Formatted and validated successfully.

## Ticket 2: Frontend Markdown Rendering
- Installed `marked` and `isomorphic-dompurify` in the `web` workspace.
- Created `MarkdownRenderer.svelte` component to safely render parsed Markdown using DOMPurify.
- Created unit tests (`markdown-renderer.svelte.spec.ts`) validating markdown output and XSS sanitization.
- Updated `web/src/routes/chats/[id]/+page.svelte` to substitute plain text with `<MarkdownRenderer>`.
- Installed `@testing-library/svelte` and fixed Svelte 5 testing DOM collision issues via container querying.
- Verified formatting and passed `npm run validate` checks.