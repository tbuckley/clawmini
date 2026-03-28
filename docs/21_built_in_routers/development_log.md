# Development Log

## Milestone 1: Router Pipeline Refactoring
- Added `GLOBAL_ROUTERS` constant to define built-in system routers.
- Added `resolveRouters` helper in `src/daemon/routers.ts` to merge user-provided configuration for global routers and append `USER_ROUTERS` for user-initiated messages.
- Updated `executeRouterPipeline` calls in `message.ts`, `cron.ts`, and `api/subagent-utils.ts` to use `resolveRouters`.
- Applied correct router logic: `USER_ROUTERS` apply only to direct user input (`handleUserMessage`), while only `GLOBAL_ROUTERS` apply to scheduled jobs (`executeJob`) and subagent messages (`executeSubagent`).
- Mocked `resolveRouters` in all affected test files.
- Verified all validation checks and tests pass with `npm run validate`.

## Milestone 2: Fix Session Timeout Logic
- Updated `createSessionTimeoutRouter` in `src/daemon/routers/session-timeout.ts` to append `sessionId` to the cron job ID when `sessionId` is present.
- Updated the job payload to include `session: { type: 'existing', id: state.sessionId }` when `state.sessionId` exists to ensure the job runs bound to the originating session.
- Changed the default prompt to append "When finished, reply with NO_REPLY_NECESSARY."
- Refactored tests in `src/daemon/routers/session-timeout.test.ts` to provide `sessionId: 'session-123'` and test that the returned `jobs` correctly include it in the `id` and the `session` binding.
- Added test verifying correct fallback when `sessionId` is missing.
- Ran `npm run validate` and confirmed all checks and tests passed cleanly.