# Tickets for Adapter Filtering Commands

## Ticket 1: Update Configuration Schemas
**Status:** Complete
**Description:** Update the configuration schemas for both the Discord and Google Chat adapters to include an optional `messages` property (type `Record<string, boolean>`). Ensure the use of Zod 4 syntax `z.record(z.string(), z.boolean())` as specified in the project notes.
**Verification:**
- Create/update unit tests for config schemas to verify the new `messages` property is parsed correctly.
- Run `npm run validate` to ensure type checks and linting pass.

## Ticket 2: Implement Shared Filtering Logic
**Status:** Complete
**Description:** Create a shared module (e.g., `src/shared/adapters/filtering.ts`) to centralize message visibility and formatting logic. Implement a `shouldDisplayMessage(message, config)` function that respects the new configuration rules (e.g., `all`, `subagent`, specific overrides) and the default agent rules. Implement a `formatMessage(message)` function to prepend `[To:<id>]` and `[From:<id>]`/`[<id>]` strings for subagent messages.
**Verification:**
- Write comprehensive unit tests for `shouldDisplayMessage` testing different rules (default, specific allows, `all: true`).
- Write unit tests for `formatMessage` verifying correct prefixing for subagent traffic.
- Run `npm run validate`.

## Ticket 3: Implement Command Parsing & Configuration State
**Status:** Complete
**Description:** Create a shared module to handle `/show`, `/hide`, and `/debug` commands. This module should parse the commands, update the configuration file (`config.json`), update the in-memory configuration reference, and handle the `/debug <N>` logic. Note that `/show all` must replace the `messages` configuration with `{"all": true}` and `/hide all` must replace it with `{}`. The debug logic must fetch recent messages using the daemon API (`trpc.getMessages.query`), filter backwards using `shouldDisplayMessage` to find ignored messages (excluding user messages without subagentIds), and format the output.
**Verification:**
- Write unit tests mocking the filesystem (to verify `config.json` updates).
- Write unit tests mocking the `trpc` client to verify the `/debug <N>` backward search logic.
- Run `npm run validate`.

## Ticket 4: Integrate with Discord Adapter
**Status:** Complete
**Description:** Update the Discord adapter (`src/adapter-discord/index.ts` and `src/adapter-discord/forwarder.ts`) to intercept the new commands before they reach the daemon, pass them to the shared command handler, and use the new shared `shouldDisplayMessage` and `formatMessage` functions for all outbound daemon messages.
**Verification:**
- Read the modified files to ensure the command interception logic is placed correctly.
- Run `npm run validate` to verify types and tests.

## Ticket 5: Integrate with Google Chat Adapter
**Status:** Not Started
**Description:** Update the Google Chat adapter (`src/adapter-google-chat/client.ts` and `src/adapter-google-chat/forwarder.ts`) to intercept the commands and use the shared filtering and formatting functions.
**Verification:**
- Read the modified files to ensure the command interception logic is placed correctly.
- Run `npm run validate`.
