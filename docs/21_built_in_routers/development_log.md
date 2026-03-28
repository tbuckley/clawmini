# Development Log

## Milestone 1: Router Pipeline Refactoring
- Added `GLOBAL_ROUTERS` constant to define built-in system routers.
- Added `resolveRouters` helper in `src/daemon/routers.ts` to merge user-provided configuration for global routers and append `USER_ROUTERS` for user-initiated messages.
- Updated `executeRouterPipeline` calls in `message.ts`, `cron.ts`, and `api/subagent-utils.ts` to use `resolveRouters`.
- Applied correct router logic: `USER_ROUTERS` apply only to direct user input (`handleUserMessage`), while only `GLOBAL_ROUTERS` apply to scheduled jobs (`executeJob`) and subagent messages (`executeSubagent`).
- Mocked `resolveRouters` in all affected test files.
- Verified all validation checks and tests pass with `npm run validate`.
