# Google Chat Adapter PRD

## Vision
To provide a seamless integration with Google Chat for Clawmini, enabling the system to receive messages from users in Google Chat via Google Cloud Pub/Sub and reply via the Google Chat API. This adapter will sit alongside the existing Discord adapter, broadening the platforms Clawmini can operate on.

## Product/Market Background
Currently, Clawmini supports interacting via Discord (`adapter-discord`) and CLI. Google Chat is widely used in enterprise environments as part of Google Workspace. Adding a Google Chat adapter allows enterprise users and teams to interact with Clawmini in their native chat environment. Unlike Discord, which uses WebSockets (via `discord.js`), Google Chat pushes events to a Cloud Pub/Sub topic which the adapter must subscribe to, or requires an HTTP endpoint. Using Pub/Sub allows the adapter to remain behind a firewall without exposing a public web server.

## Use Cases
1. **Direct Messaging:** A user sends a direct message to the Clawmini bot in Google Chat. The bot receives the message via Pub/Sub, forwards it to the daemon, and replies using the Google Chat API.
2. **Space Mentions:** A user @mentions the Clawmini bot in a Google Chat space. The bot replies in the same thread.
3. **Continuous Operation:** The adapter can be started in the background (similar to the Discord adapter) and maintain a long-running Pub/Sub subscription and a daemon connection.

## Requirements
### Functional
- **Message Ingestion:** The adapter must listen to a specified Google Cloud Pub/Sub subscription for incoming Google Chat events (`MESSAGE` events).
- **Message Dispatch:** The adapter must forward incoming messages to the Clawmini daemon using the tRPC client (`trpc.sendMessage.mutate`), translating the Google Chat payload to the Clawmini message format.
- **Message Reply:** The adapter must subscribe to daemon messages (`trpc.waitForMessages.subscribe`) and forward them to the originating Google Chat space/thread via the Google Chat REST API (`spaces.messages.create`).
- **File Attachments:** The adapter must support downloading file attachments from Google Chat and forwarding them to the daemon. The maximum file size limit should be 25MB (unless Google Chat imposes a different hard limit).
- **State Management:** The adapter must track the `lastSyncedMessageId` locally (e.g., in `state.json`) to prevent duplicate message dispatches on restart, matching the behavior of the Discord adapter.
- **Configuration:** The adapter must read configuration from a `config.json` file, similar to `adapter-discord`. Configuration should include:
  - Pub/Sub subscription name.
  - Default `chatId` for daemon alignment.
  - Authorized users (either user IDs or emails, whichever provides the most secure restriction mechanism) to restrict access to the bot.

### Non-Functional
- **Authentication:** The adapter must rely on Google Application Default Credentials (ADC) for authenticating both the Pub/Sub subscription listener and the Google Chat API requests.
- **Resilience:** If the daemon restarts, the adapter should reconnect automatically.
- **Scalability:** Should handle standard chat volumes efficiently.
- **Security:** Ensure only authorized users can interact with the bot.

## Privacy & Security Concerns
- The adapter will use Application Default Credentials (ADC). Environment permissions should be managed properly on the host to avoid privilege escalation.
- The adapter must validate that incoming messages via Pub/Sub originated from Google Chat and only process those originating from the whitelist of authorized users.
- Ensuring credentials and file attachments are processed securely and temporarily stored before being forwarded to the daemon.