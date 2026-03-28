# Development Log

## Session 1
- Initialised Ticket 1: Update State and Config Schemas for Multi-Chat Support.
- Verified schema changes for Discord and Google Chat adapters in git diff.
- Identified test failures in `npm run validate` and updated tests in `src/adapter-discord/config.test.ts`, `src/adapter-discord/forwarder.test.ts`, and `src/adapter-google-chat/state.test.ts` to expect the new schema formats properly.
- Completed Ticket 1.
## Session 2
- Implemented Ticket 2: First Contact Protocol and Message Pre-processing.
- Updated Discord adapter to allow processing of guild messages, but restricted by the `requireMention` config.
- Added the First Contact Protocol to both Discord and Google Chat adapters. Unmapped contexts now receive a friendly warning instead of silently dropping the message.
- Fixed broken Vitest test cases by properly mocking state mapping (`readDiscordState` and `readGoogleChatState`) to satisfy the new First Contact constraints.
- Added E2E type overrides for test logs.

## Session 3
- Implemented Ticket 3: Routing Commands (`/chat` and `/agent`).
- Created `src/shared/adapters/routing.ts` to share logic between both adapters.
- Extended the daemon's TRPC router (`src/daemon/api/user-router.ts`) to expose `getChats`, `getAgents`, and `createChat` (with `agentId` assignment) functionality for adapter clients.
- Addressed a 1:1 mapping constraint where a user attempting to map a chat already mapped to another channel receives an instructional error.
- Intercepted `/chat` and `/agent` commands inside `src/adapter-discord/index.ts` and `src/adapter-google-chat/client.ts`.
- Mocked TRPC clients and verified routing behavior via Vitest `routing.test.ts`.
