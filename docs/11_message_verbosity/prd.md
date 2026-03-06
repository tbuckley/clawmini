# Feature: Message Verbosity Levels

## Vision
To provide users with more control over the signal-to-noise ratio in their interaction history by introducing message verbosity levels. This will allow the system to log detailed background actions or non-user-facing updates without cluttering the main conversation stream, while giving power users the ability to inspect exactly what the system is doing.

## Product/Market Background
Currently, all logs from the daemon (including agent responses, error messages, routing info, and executed commands) are grouped into a binary `debugView` toggle in the WebUI. Additionally, the Discord integration forwards every single log message to the user as long as it contains content or a file, which can lead to spam when agents are performing behind-the-scenes reasoning or repetitive tasks.

By categorizing messages into `default`, `debug`, and `verbose` levels, we align with standard software logging paradigms. The user experience is simplified for the average user, while maintaining complete transparency for developers and advanced users.

## Requirements

### 1. Data Model (`CommandLogMessage`)
- Introduce an optional `level` property to the `CommandLogMessage` interface in `src/shared/chats.ts`.
- `level` should be of type `'default' | 'debug' | 'verbose'`.
- If `level` is missing or undefined on an existing message, it should be treated as `'default'`.

### 2. Message Generation (Daemon)
- When generating a `CommandLogMessage` in the daemon (e.g., in `src/daemon/message.ts`), assign the `level` property based on the message content.
- **Rule 1**: If the message content (e.g., agent stdout) contains the exact string `"NO_REPLY_NECESSARY"`, the message `level` must be set to `'verbose'`.
- All other messages can default to `'default'` for now (future iterations may use `'debug'` for retry logs, etc.).

### 3. Web UI Updates
- **State Management**: Replace the boolean `appState.debugView` with a string `appState.verbosityLevel` (with values `'default' | 'debug' | 'verbose'`) in `web/src/lib/app-state.svelte.ts`. The default value should be `'default'`.
- **UI Control**: Replace the `Switch` component in `web/src/routes/+layout.svelte` with a cyclical toggle button (e.g., an icon button that rotates between three distinct icons/colors representing Default, Debug, and Verbose states).
- **Message Filtering & Display** (`web/src/routes/chats/[id]/+page.svelte`):
  - **Visibility**:
    - When `verbosityLevel` is `'default'`, only show messages with `level: 'default'` (or undefined).
    - When `verbosityLevel` is `'debug'`, show messages with `level: 'default'` and `'debug'`.
    - When `verbosityLevel` is `'verbose'`, show all messages.
  - **Detail Level**:
    - When `verbosityLevel` is `'default'` or `'debug'`, only display the message `content`. Hide the `command`, `stderr`, and `stdout` raw views.
    - When `verbosityLevel` is `'verbose'`, reveal all message details including `command` and `stderr` (similar to the current `debugView = true` state).
  - **Visual Distinction**: Verbose messages must look visually distinct from `default`/`debug` messages (e.g., using a distinct background color, border, or icon indicating it is a verbose background task).

### 4. Discord Forwarder Updates
- Modify `src/adapter-discord/forwarder.ts` to check the `level` property of incoming `CommandLogMessage`s.
- Do not forward messages if their `level` is exactly `'verbose'`.
- Messages with `level: 'default'`, `'debug'`, or undefined should still be forwarded as normal.

## Privacy/Security/Accessibility Concerns
- **Accessibility**: The new cyclical toggle button in the WebUI must have an appropriate `aria-label` that dynamically updates to indicate the current verbosity level state, ensuring screen reader users can interact with it effectively.
- **Security**: No new security risks are introduced, as we are merely filtering the display of data the user already has access to.
- **Privacy**: No new privacy concerns. Data is stored locally as before.