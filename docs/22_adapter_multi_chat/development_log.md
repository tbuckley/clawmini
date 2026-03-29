# Development Log

## Session 1
- Initialised Ticket 1: Update State and Config Schemas for Multi-Chat Support.
- Verified schema changes for Discord and Google Chat adapters in git diff.
- Identified test failures in `npm run validate`.
- Fixed `channelChatMap` to be an object instead of a string array in test and code logic for `src/adapter-discord/client.test.ts`, `src/adapter-discord/client.ts`, `src/adapter-discord/state.test.ts`, `src/adapter-discord/forwarder.ts`.
- Updated schema typing to allow undefined explicitly where required, maintaining strict structural compatibility.
- Re-run `npm run validate`, successfully passing all checks.
- Completed Ticket 1 in `tickets.md` and committed all changes.

## Session 2
- Started work on Ticket 2: Implement "First Contact" Protocol (Discord).
- Refactored `startDiscordIngestion` in `src/adapter-discord/client.ts` to implement the required First Contact logic:
  - Check if `targetChatId` is mapped for a given channel.
  - If not, verify if it's the very first message processed by the adapter by checking if `channelChatMap` is empty.
  - Automatically map the first channel to `config.chatId` (default) and process the message.
  - If it's not the first message, reply with a strict, non-processed warning indicating the channel is unmapped and block the message from daemon propagation.
- Verified and fixed Discord tests to ensure correct behaviour:
  - Ensured routing commands correctly populate `channelChatMap`.
  - Added new mock properties `mockMessage.reply` and modified expected return shapes so subsequent tests relying on default properties (like `channelChatMap`) don't fail.
- When mocking discord.js Messages, ensure they match the properties required by the code paths (e.g. `channelId`, `attachments`, `reply`).
- Confirmed all checks (`npm run validate`) pass properly.

## Session 3
- Started work on Ticket 3: Implement Dynamic Subscriptions (Discord Forwarder).
- Updated `startDaemonToDiscordForwarder` in `src/adapter-discord/forwarder.ts` to:
  - Establish `trpc.waitForMessages.subscribe` for each chat mapped in `state.channelChatMap`.
  - Track `lastSyncedMessageIds` for each daemon chat independently rather than globally.
  - Set up an `fs.watch` event listener on `state.json` to dynamically synchronize subscriptions on changes.
  - Correctly extract the target `channelId` to post messages by doing a reverse lookup on `state.channelChatMap`.
- Resolved a Vitest unhandled rejection hook failure where a thrown Error during `syncSubscriptions` wasn't properly caught within an async boundary.
- Fixed a bug causing an infinite loop in Vitest caused by `setInterval` inside `vi.runAllTimersAsync()` by refactoring tests to use `vi.advanceTimersByTimeAsync(30000)` instead.
- Confirmed all checks (`npm run validate`) pass properly.

## Session 4
- Started work on Ticket 5: Add Google Chat Space Subscription Config & State Schemas.
- Updated `GoogleChatStateSchema` in `src/adapter-google-chat/state.ts` to use an object for `channelChatMap` handling space subscriptions (`chatId`, `subscriptionId`, `expirationDate`).
- Added schema migration paths in `readGoogleChatState` to support single-chat legacy formats and migrated `driveOauthTokens` to `oauthTokens`.
- Replaced `driveOauthClientId` and `driveOauthClientSecret` with generic `oauthClientId` and `oauthClientSecret` in `src/adapter-google-chat/config.ts`.
- Updated `src/adapter-google-chat/auth.ts` to use `getUserAuthClient()` matching the required new OAuth flows and multiple scopes for Drive and Chat readonly.
- Updated `src/adapter-google-chat/index.ts` to initialize `getUserAuthClient()` when OAuth secrets are present.
- Updated numerous test files to accommodate the structural schema changes and OAuth renaming.
- Successfully verified tests passing using `npm run validate`.
- Marked Ticket 5 as Completed.

## Session 5
- Implemented Ticket 6: Space Subscription Lifecycle (`ADDED_TO_SPACE` & `REMOVED_FROM_SPACE`).
- Extracted `handleAddedToSpace` and `handleRemovedFromSpace` into `src/adapter-google-chat/subscriptions.ts` to keep `client.ts` clean and below the line limits.
- Extracted `handleCardClicked` into `src/adapter-google-chat/cards.ts` to reduce `client.ts` file length.
- Added API calls to `https://workspaceevents.googleapis.com/v1/subscriptions` using the Google User's OAuth tokens to dynamically subscribe to `google.workspace.chat.message.v1.created` when the bot is added to spaces.
- Intercepted `ADDED_TO_SPACE` and `REMOVED_FROM_SPACE` early in the Google Chat ingestion pipeline to bypass the first contact unmapped warnings.
- Updated `client.test.ts` to simulate and test subscriptions logic accurately using mock fetch interactions.
- Resolved various TypeScript alignment errors around strict typing of `mappedChatId` and nested objects inside the state JSON configuration.

## Session 6
- Implemented Ticket 7: Dual-Pipeline Pub/Sub Worker Logic.
- Updated `startGoogleChatIngestion` in `src/adapter-google-chat/client.ts` to process native Bot Events and Workspace Events.
- Implemented a 60-second LRU cache (using Map) to deduplicate Message IDs and drop duplicate messages when the bot is mentioned and triggering both pipelines.
- Added explicit sender type check to drop messages from `BOT` to prevent infinite reply loops.
- Added tests simulating Workspace Event payloads and Bot Event payloads.
- Verified test coverage for duplicate IDs and BOT message dropping.
- Fixed linter warnings about missing `const` and explicit `any` types.
- Fixed maximum line constraints by simplifying logical conditionals.
- Ran `npm run validate` which passed format, lint, check, and unit/E2E tests.