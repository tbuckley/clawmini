# Notes on Discord and Google Chat Adapters

## Current Policy Mechanism
- Policies are created via `PolicyRequestService`.
- A pending policy creates a `PolicyRequestMessage` with `role: 'policy'`.
- `forwarder.ts` for both Discord and Google Chat currently filters for `isAgentDisplay` messages (`displayRole === 'agent' || role === 'agent' || role === 'legacy_log'`).
- This means `role: 'policy'` messages are likely NOT being forwarded to Discord and Google Chat right now, or if they are, they are handled via `legacy_log` or we need to update the forwarders to explicitly handle `role: 'policy'`. Wait, `daemon/agent/chat-logger.ts` creates `PolicyRequestMessage` with `role: 'policy'`, so they are not forwarded to Discord or Google Chat currently unless `displayRole` is set to `agent`.
Wait, looking at `slash-policies.ts`, it seems `/approve` and `/reject` are standard text commands.

## Discord UI Capabilities
- Discord supports rich messages with Action Rows and Buttons.
- We can send a message with an "Approve" (Success/Primary color) button and a "Reject" (Danger color) button.
- When clicked, the Discord adapter receives an `interactionCreate` event.
- Discord supports opening a "Modal" when a button is clicked, which allows text input. This would be perfect for the optional "Reject Rationale".
- The adapter uses `discord.js`.

## Google Chat UI Capabilities
- Google Chat supports Card V2 messages.
- We can send a Card with a ButtonList containing "Approve" and "Reject" buttons.
- Clicking a button generates a `CARD_CLICKED` event that is sent via the same Pub/Sub subscription currently used for `MESSAGE` events.
- To handle the "Reject Rationale", Google Chat cards support form inputs (like `TextInput`), but these are part of the card itself, not a popup modal like Discord (Dialogs exist but are complex). An alternative is to just have the "Reject" button run `/reject <id>`, or provide a text input *in the card* that is submitted along with the Reject button.
- The Google Chat adapter uses Pub/Sub for ingestion and the REST API for sending.

## Required Changes
1. **Update Forwarders**: Modify `forwarder.ts` in both adapters to intercept `role: 'policy'` and `status: 'pending'` messages and format them using the platform's rich UI components.
2. **Discord Client**: Add an `interactionCreate` event listener in `src/adapter-discord/index.ts` to handle button clicks and modal submissions. Map these to the daemon's `approve` / `reject` API or just inject the `/approve <id>` / `/reject <id> <reason>` text commands into the chat.
3. **Google Chat Client**: Update `src/adapter-google-chat/client.ts` to handle `CARD_CLICKED` events from Pub/Sub. Extract the action/parameters and map them to the daemon's commands.
