# PRD: Discord Adapter for Clawmini

## Vision
To provide a seamless, secure, and optional way for users to interact with their Clawmini agents via Discord. This allows users to leverage Discord's mobile and desktop interfaces as a bridge to their local development workflows, while maintaining strict security through single-user authorization.

## Product/Market Background
Clawmini is a local-first agentic CLI tool. While the terminal and web interface are powerful, users often want to interact with their agents on the go or through familiar communication apps. Discord is a natural fit for developers, offering robust APIs, cross-platform support, and a structured environment (channels/threads) that maps well to chat-based agent interactions.

## Use Cases
- **Mobile Access:** A developer wants to check the status of a long-running task or trigger a quick agent action from their phone.
- **Unified Interface:** A user wants to keep their agent interactions alongside their other developer communications in Discord.
- **Asynchronous Interaction:** A user sends a message to an agent on Discord, goes offline, and checks the agent's detailed output later when they return to their workstation.

## Requirements

### 1. Discord Bot Adapter (CLI)
- A new standalone CLI component located in `src/adapter-discord/`.
- Communicates with the Clawmini daemon via TRPC over a Unix socket.
- Manages a Discord Bot connection using a bot token provided in configuration.

### 2. Security & Authorization
- **Single User Lock:** The adapter MUST be configured with a specific Discord User ID.
- **Strict Filtering:** The bot MUST ignore all messages (and log an error for unauthorized attempts) from any user other than the configured ID.
- **Local Config:** Bot tokens and User IDs are stored locally in `.clawmini/adapters/discord/config.json`.

### 3. Bi-directional Synchronization
- **Discord -> Daemon:**
  - Listen for DMs from the authorized user.
  - Forward messages to the Clawmini daemon using the `sendMessage` TRPC endpoint.
  - Map the Discord DM channel to a specific Clawmini chat (1:1 mapping).
- **Daemon -> Discord:**
  - The daemon will be updated to support a message subscription/observation mechanism.
  - The adapter will subscribe to new messages from the daemon and forward them to the appropriate Discord channel.
  - Support "replay" on startup: Check for messages in the daemon's history that haven't been synced to Discord yet.

### 4. Reliability & State Management
- **Sync State:** Store a local cursor (e.g., last synced message timestamp or ID) in `.clawmini/adapters/discord/state.json` to prevent duplicates and ensure no messages are missed during downtime.
- **Debouncing:** Implement debouncing for incoming messages to handle rapid-fire inputs or redundant events.
- **Startup Sync:** On launch, the adapter syncs any missed messages in both directions.

### 5. Daemon Enhancements
- Add a new TRPC endpoint or event-driven mechanism to the daemon to allow external adapters (and the `web` interface) to receive real-time message updates without polling the filesystem.

### 6. Documentation
- Provide a step-by-step setup guide in `./docs/guides/discord_adapter_setup.md` covering:
  - Creating a Discord Application/Bot in the Developer Portal.
  - Retrieving the Bot Token.
  - Finding your Discord User ID.
  - Configuring and running the adapter.

## Privacy & Security
- **No Data Exfiltration:** The adapter only forwards messages to the user's own Discord DM channel. No data is sent to third-party servers other than Discord's own infrastructure.
- **Token Safety:** Bot tokens must never be logged or shared.
- **Access Control:** The single-user lock is the primary defense against unauthorized agent access.

## Accessibility
- Leverages Discord's native accessibility features (screen readers, high contrast modes) for interacting with Clawmini.
