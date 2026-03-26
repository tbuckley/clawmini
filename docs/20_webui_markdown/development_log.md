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

## Ticket 3: Global Markdown Toggle Setting
- Added `markdownEnabled` property (default `true`) to the global `appState` in `web/src/lib/app-state.svelte.ts`.
- Implemented localStorage persistence for `markdownEnabled` within the `web/src/routes/+layout.svelte` using an `$effect` block and initialization inside `onMount`.
- Added a new UI toggle button in the header (`web/src/routes/+layout.svelte`) next to the verbosity toggle using `lucide-svelte`'s `Type` and `FileCode` icons.
- Connected the `markdownEnabled` toggle to the Markdown rendering logic in `web/src/routes/chats/[id]/+page.svelte` so it conditionally renders plain text (`whitespace-pre-wrap`) when disabled.
- Checked formatting, and ran `npm run format` to fix any issues.
- Ran `npm run validate` to ensure all tests and linting passed successfully.