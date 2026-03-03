# Research Notes for Discord Adapter

## Architecture
- The daemon handles running commands and stores messages in `.gemini/chats/<chat_id>/chat.jsonl`.
- The CLI (`src/cli/client.ts`) communicates with the daemon via TRPC over a Unix socket (`http://localhost` using a custom fetch with `socketPath`).
- The TRPC router (`src/daemon/router.ts`) exposes endpoints like `sendMessage` to trigger an agent run.
- There is currently no TRPC endpoint to *read* messages or *subscribe* to new messages, though `src/shared/chats.ts` provides `getMessages` and `listChats` to read from the filesystem directly.
- The adapter will be a new top-level entry point (e.g., `src/adapter-discord/`) or a CLI command (e.g. `clawmini-lite discord-adapter`). The prompt implies a standalone CLI (`its own src/adapter-discord/ CLI`).

## Requirements Extracted
- **Security:** Ensure ONLY one configured user can communicate with it. Messages from other users must be ignored or logged as an error.
- **Bi-directional forwarding:**
  - Discord -> Daemon: Listen for messages from Discord (via discord.js or similar), verify user ID, send via TRPC `sendMessage` (or equivalent).
  - Daemon -> Discord: Watch for new messages in the `chat.jsonl` file (or add a TRPC subscription), and send them to the Discord user via the bot.
- **Startup Sync:** Upon startup, check for any missed messages in both directions.
- **Debouncing:** Debounce incoming messages to prevent duplication.
- **Configuration:** Needs a Discord Bot Token, a single allowed Discord User ID, and potentially the Chat ID to sync with (or it could sync with a specific chat or the default chat).
- **Documentation:** Step-by-step setup instructions in `./docs/guides/discord_adapter_setup.md`.