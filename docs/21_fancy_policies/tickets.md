# Tickets for Fancy Policies

## Ticket 1: Update forwarders to pass through policy requests
**Status**: completed
**Description**: 
Update the message filtering logic in `src/adapter-discord/forwarder.ts` and `src/adapter-google-chat/forwarder.ts` to ensure that messages with `role: 'policy'` and `status: 'pending'` are passed through to the adapters' formatting logic, rather than being filtered out.
**Verification Steps**:
- Verify with unit tests in both adapters that policy messages are forwarded.
- Run `npm run validate` to ensure tests and type checks pass.

## Ticket 2: Implement Discord Adapter Forwarding for Policies
**Status**: completed
**Description**: 
Modify `src/adapter-discord/forwarder.ts` to format pending policy requests (`role: 'policy'`, `status: 'pending'`) using Discord `MessageEmbeds` and `MessageActionRows`. The output must include a Success "Approve" button (custom ID: `approve_<id>`) and a Danger "Reject" button (custom ID: `reject_<id>`).
**Verification Steps**:
- Add unit tests for the Discord forwarder's policy formatting logic.
- Run `npm run format && npm run lint:fix`.
- Run `npm run validate` to ensure tests and type checks pass.

## Ticket 3: Implement Discord Adapter Interaction Handling
**Status**: completed
**Description**: 
Update `src/adapter-discord/index.ts` (or related interaction handler) to listen for `interactionCreate` events. 
- For button interactions matching `approve_<id>`, ingest the `/approve <id>` command to the daemon.
- For button interactions matching `reject_<id>`, present the user with a Discord Modal asking for an optional rationale.
- Handle the subsequent Modal submission to ingest the `/reject <id> [rationale]` command to the daemon.
**Verification Steps**:
- Add unit tests validating the `interactionCreate` handling for both buttons and modals.
- Run `npm run format && npm run lint:fix`.
- Run `npm run validate`.

## Ticket 4: Implement Google Chat Adapter Forwarding for Policies
**Status**: not started
**Description**: 
Modify `src/adapter-google-chat/forwarder.ts` to format pending policy requests (`role: 'policy'`, `status: 'pending'`) using Google Chat Card V2. The card should include the request information and a `ButtonList` with "Approve" and "Reject" buttons. The `action` property on these buttons should be configured to trigger a `CARD_CLICKED` event.
**Verification Steps**:
- Add unit tests for the Google Chat forwarder's policy formatting logic.
- Run `npm run format && npm run lint:fix`.
- Run `npm run validate`.

## Ticket 5: Implement Google Chat Adapter Interaction Handling
**Status**: not started
**Description**: 
Update `src/adapter-google-chat/client.ts` to handle `CARD_CLICKED` events delivered via the Pub/Sub subscription. Extract the action and policy ID from the event, and inject the corresponding `/approve <id>` or `/reject <id>` text command into the daemon command ingestion flow.
**Verification Steps**:
- Add unit tests validating the processing of `CARD_CLICKED` events.
- Run `npm run format && npm run lint:fix`.
- Run `npm run validate`.