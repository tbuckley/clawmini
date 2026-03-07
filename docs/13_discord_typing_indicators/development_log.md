# Development Log - Discord Typing Indicators

## Ticket 1: Define Daemon Event
- Started work on Ticket 1.
- Identified `src/daemon/events.ts` as the file to update.
- Will add `DAEMON_EVENT_TYPING` constant and `emitTyping` function.
- All code formatted, linted, and tests pass.
- Ticket 1 completed.

## Ticket 2: Add tRPC Subscription Endpoint
- Added `waitForTyping` subscription endpoint to `AppRouter` in `src/daemon/router.ts`.
- Imported `DAEMON_EVENT_TYPING` from `events.ts`.
- Added new subscription tests for `waitForTyping` in `src/daemon/router.test.ts` to ensure it filters events by `chatId`.
- Resolved formatting, linting, and type-checking issues in the tests.
- All code formatted, linted, and tests pass.
- Ticket 2 completed.