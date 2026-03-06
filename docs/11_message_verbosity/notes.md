# Notes on Message Verbosity Feature

## Current State
- `CommandLogMessage` in `src/shared/chats.ts` currently does not have a `level` property.
- WebUI has a boolean `appState.debugView` toggled by a `Switch` component (`web/src/routes/+layout.svelte` and `web/src/routes/chats/[id]/+page.svelte`). This toggle currently shows/hides stderr, exit codes, and command paths on log messages.
- The Discord forwarder (`src/adapter-discord/forwarder.ts`) currently forwards all messages with `role: 'log'` as long as they have content or files.
- Agent output is captured in `src/daemon/message.ts` via `runCommand`, putting `stdout` into the message `content`.
- Some internal messages (like retry delays or router messages) are also stored as `CommandLogMessage`.

## Requirements
- Add `level` property to `CommandLogMessage` (optional).
- Define enums for log levels (e.g., `default`, `debug`, `verbose`).
- Replace the boolean toggle in the WebUI with a cyclic toggle button to switch between these three states, using good icons/colors.
- Discord forwarder should ignore the most verbose setting by default.
- Any message content containing `"NO_REPLY_NECESSARY"` should automatically be labeled as verbose.

## Files to Update
- **Data Model**: `src/shared/chats.ts` (Add `level` to `CommandLogMessage`, define `LogLevel` enum/type).
- **Daemon Generation**: `src/daemon/message.ts`, `src/daemon/router.ts` (When generating a message, check if `"NO_REPLY_NECESSARY"` is in the content and set `level` to `'verbose'`. Otherwise maybe `'default'` or `'debug'` depending on the type of message - wait, the prompt says "To start, any message containing NO_REPLY_NECESSARY will be labeled as verbose").
- **Web UI Data Model & Logic**: `web/src/lib/types.ts` (if exists), `web/src/lib/app-state.svelte.ts` (Change `debugView` to `verbosityLevel`), `web/src/routes/+layout.svelte` (Replace `Switch` with a 3-state icon button), `web/src/routes/chats/[id]/+page.svelte` (Filter or adjust display based on the selected level).
- **Discord Forwarder**: `src/adapter-discord/forwarder.ts` (Skip forwarding if `level === 'verbose'`).

## Open Questions
- What should be the exact names of the levels? (e.g., `'default' | 'debug' | 'verbose'`)
- What should determine if a message is `debug` vs `default` initially, other than the `NO_REPLY_NECESSARY` string rule? (Are standard agent responses `'default'`, and retry/error messages `'debug'`?)
- In the Web UI, should a `'default'` message be visible across all levels, and `'verbose'` messages *only* visible at the `'verbose'` level? (i.e., Level filters: Default -> shows only Default; Debug -> shows Default + Debug; Verbose -> shows Default + Debug + Verbose)
