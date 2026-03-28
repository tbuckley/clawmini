# Product Requirements Document: Fancy Policies

## 1. Vision
To enhance the developer experience by providing interactive, rich-UI elements for policy approval requests directly within chat platforms (Discord and Google Chat). Instead of forcing users to manually type `/approve <id>` or `/reject <id>`, they can click platform-native buttons to respond to sandbox policy requests instantly.

## 2. Product/Market Background
Currently, when a sandbox policy requires user approval, the daemon outputs a text-based message (`Role: policy`, `Status: pending`) instructing the user to run `/approve <id>` or `/reject <id> [rationale]`. While functional, this creates friction, especially in mobile or fast-paced chat environments. Both Discord and Google Chat support interactive components (buttons, cards, modals) that can significantly streamline this workflow.

## 3. Use Cases
1. **Approve a Policy Request (Discord & Google Chat):**
   - The user receives a visually distinct message (Embed/Card) containing the details of the policy request (Command, Arguments).
   - The user clicks a green "Approve" button.
   - The system executes the policy and updates the chat.

2. **Reject a Policy Request without Rationale (Google Chat & Discord):**
   - The user clicks a red "Reject" button.
   - For Google Chat, the request is immediately rejected.
   - For Discord, the user is presented with a modal where they can leave the rationale empty and submit.

3. **Reject a Policy Request with Rationale (Discord):**
   - The user clicks a red "Reject" button.
   - A Discord modal appears asking for an optional rationale.
   - The user enters a rationale (e.g., "Command arguments look suspicious") and submits.
   - The rationale is passed back to the daemon via the `/reject <id> <rationale>` command flow.

## 4. Requirements

### 4.1. Daemon Changes
- Currently, policy requests are emitted as `PolicyRequestMessage` objects (with `role: 'policy'`). Ensure these messages are successfully forwarded by the `adapter-discord` and `adapter-google-chat` forwarders. (Currently they might be filtered out if they lack `displayRole: 'agent'`).

### 4.2. Discord Adapter (`adapter-discord`)
- **Forwarding (`forwarder.ts`):** 
  - Intercept messages where `role === 'policy'` and `status === 'pending'`.
  - Format these messages using Discord's MessageEmbeds and MessageActionRows.
  - Include an "Approve" button (Style: Success, Custom ID: `approve_<id>`) and a "Reject" button (Style: Danger, Custom ID: `reject_<id>`).
- **Interaction Handling (`index.ts` / `client.ts`):**
  - Listen for `interactionCreate` events.
  - If it's a Button interaction for `approve_<id>`, send the `/approve <id>` command to the daemon.
  - If it's a Button interaction for `reject_<id>`, respond with a `ModalSubmit` interaction displaying a text input for the optional rationale.
  - If it's a Modal submission for a rejection, send the `/reject <id> <rationale>` command to the daemon.
  - Once handled, optionally update the original message to remove the buttons or mark it as "Handled".

### 4.3. Google Chat Adapter (`adapter-google-chat`)
- **Forwarding (`forwarder.ts`):**
  - Intercept messages where `role === 'policy'` and `status === 'pending'`.
  - Format these messages using Google Chat Card V2.
  - Include a Card Header with the request info, and a ButtonList with an "Approve" button and a "Reject" button.
  - Set the `action` property on the buttons to trigger a `CARD_CLICKED` event with the action name (e.g., `approve` or `reject`) and the policy ID.
- **Interaction Handling (`client.ts`):**
  - Listen for `CARD_CLICKED` events (type `CARD_CLICKED` inside the Pub/Sub MESSAGE payload).
  - Extract the action and policy ID.
  - For `approve`, send the `/approve <id>` command to the daemon.
  - For `reject`, immediately send the `/reject <id>` command to the daemon (skipping rationale input as it requires synchronous HTTP for dialogs).

## 5. Security, Privacy, and Accessibility Concerns
- **Security:** Ensure that the interaction endpoints (Pub/Sub for Google Chat, Discord WebSockets) properly authenticate that the clicking user is authorized to interact with the bot. The existing adapter logic for command ingestion already performs these checks; button clicks should route through the same authorization paths.
- **Accessibility:** Ensure button labels and card titles are clear and descriptive.
- **State Integrity:** Handle cases where a user clicks a button for an already-approved or already-rejected policy gracefully (e.g., the daemon should return an error stating the policy is no longer pending, and the UI should ideally reflect that or ignore the click).
