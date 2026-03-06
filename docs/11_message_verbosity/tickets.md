# Message Verbosity Feature Tickets

## 1. Update Data Model (Status: Complete)
- **Task**: Update `src/shared/chats.ts` to add an optional `level` property (`'default' | 'debug' | 'verbose'`) to the `CommandLogMessage` interface.
- **Verification**: Run `npm run check` and `npm run test` to ensure there are no TypeScript compilation errors resulting from this interface change.

## 2. Update Daemon Message Generation (Status: Not Started)
- **Task**: Modify message generation logic in the daemon (e.g., `src/daemon/message.ts`) so that when a `CommandLogMessage` is generated, if its content includes the exact string `"NO_REPLY_NECESSARY"`, the `level` property is set to `'verbose'`.
- **Verification**: Write/update tests in `src/daemon/` to verify this behavior, and run `npm run format:check && npm run lint && npm run check && npm run test`.

## 3. Update Web UI State Management (Status: Not Started)
- **Task**: In `web/src/lib/app-state.svelte.ts` (or equivalent Web UI state file), replace the boolean `debugView` property with a string `verbosityLevel` initialized to `'default'`. The valid values should be `'default' | 'debug' | 'verbose'`.
- **Verification**: Run `npm run check` and `npm run test` to verify state changes compile and pass tests.

## 4. Update Web UI Controls (Status: Not Started)
- **Task**: In `web/src/routes/+layout.svelte`, replace the existing `Switch` component used for `debugView` with a cyclical toggle button. This button should rotate between the three states ('default', 'debug', 'verbose') using distinct icons/colors and must include a dynamic `aria-label` for accessibility.
- **Verification**: Run `npm run check` and `npm run test`.

## 5. Update Web UI Message Filtering and Display (Status: Not Started)
- **Task**: Update `web/src/routes/chats/[id]/+page.svelte` to implement filtering and detailed views based on `verbosityLevel`:
  - `'default'` level: Show only `level: 'default'` (or undefined). Show only the message content.
  - `'debug'` level: Show `level: 'default'` and `'debug'`. Show only the message content.
  - `'verbose'` level: Show all messages. Reveal `command`, `stderr`, and `stdout` raw views.
  - Ensure verbose messages look visually distinct (e.g., distinct background color, border, or icon).
- **Verification**: Run `npm run check` and `npm run test`.

## 6. Update Discord Forwarder (Status: Not Started)
- **Task**: Modify `src/adapter-discord/forwarder.ts` to check the `level` property of incoming `CommandLogMessage`s. Ensure that messages with `level: 'verbose'` are NOT forwarded to Discord.
- **Verification**: Update Discord forwarder unit tests, then run `npm run check` and `npm run test`.

## 7. Final Quality Check (Status: Not Started)
- **Task**: Ensure all code meets the project's formatting, linting, and testing standards.
- **Verification**: Run `npm run format:check && npm run lint && npm run check && npm run test` and confirm everything passes cleanly.
