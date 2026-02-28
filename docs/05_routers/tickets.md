# Routers Feature Tickets

## Ticket 1: Update Configuration Schema
**Description:** 
Update the schema definitions in `src/shared/config.ts` to support a new `routers` property. This should be an optional array of strings, available in both global (`.clawmini/settings.json`) and per-chat settings.

**Verification:**
- Ensure type definitions are updated.
- Verify that default settings parsing still succeeds.
- Run the full suite of automated checks: `npm run format:check && npm run lint && npm run check && npm run test`

**Status:** Complete

---

## Ticket 2: Update ChatMessage Schema
**Description:** 
Update the `ChatMessage` schema in `src/shared/chats.ts` to support an optional `source` property. This property should allow the literal value `'router'` for messages where `role` is `'log'`.

**Verification:**
- Update `src/shared/chats.test.ts` to test the new schema properties.
- Run the full suite of automated checks: `npm run format:check && npm run lint && npm run check && npm run test`

**Status:** Complete

---

## Ticket 3: Implement Built-in Routers
**Description:** 
Implement the internal logic for the built-in routers `@clawmini/slash-new` and `@clawmini/slash-command`.
- `@clawmini/slash-new`: Detects if the message starts with `/new`, removes it from the message text, and generates a new random UUID for the session.
- `@clawmini/slash-command`: Detects slash commands (e.g., `/foo` or `/foo:bar`) and replaces them with the contents of the matching file in `.clawmini/commands/`. **Crucial:** Implement strict path traversal protection to ensure only files within `.clawmini/commands/` can be read.

**Verification:**
- Create dedicated unit tests for these built-in router functions.
- Run the full suite of automated checks: `npm run format:check && npm run lint && npm run check && npm run test`

**Status:** Complete

---

## Ticket 4: Create Router Pipeline Execution Logic
**Description:** 
Create a new file `src/daemon/routers.ts` to handle the middleware pipeline execution.
- Implement a function that takes an initial state (`message`, `chatId`, `agentId`, `sessionId`, `env`).
- Fetch the `routers` array from the current settings.
- Iterate through the routers sequentially:
  - For built-in routers, call the respective internal functions.
  - For custom routers, execute them as shell commands passing the current JSON state to `stdin` and parsing `stdout` as JSON.
- Merge valid output properties (`message`, `agent`, `session`, `env`, `reply`) into the state for the next step.
- Implement silent failure handling (non-zero exits, invalid JSON, timeouts should log errors but not halt the pipeline).

**Verification:**
- Create `src/daemon/routers.test.ts` to test both built-in router invocation and custom shell script execution (using mock scripts).
- Run the full suite of automated checks: `npm run format:check && npm run lint && npm run check && npm run test`

**Status:** Complete

---

## Ticket 5: Integrate Router Pipeline into Message Handling
**Description:** 
Integrate the router pipeline into `handleUserMessage` in `src/daemon/message.ts`.
- Before adding the message to the queue for agent execution, pass the current state through the router pipeline.
- Apply the resulting state changes (updated `message`, `agentId`, `sessionId`, `env`).
- If the pipeline returns a `reply` string, inject a new `ChatMessage` with `role: 'log'` and `source: 'router'` into the chat timeline immediately before the agent is invoked.

**Verification:**
- Update `src/daemon/message.test.ts` to verify that routing modifications apply correctly (e.g., sessions are changed, text is replaced) and replies are properly injected into the timeline.
- Run the full suite of automated checks: `npm run format:check && npm run lint && npm run check && npm run test`

**Status:** Complete

---

## Ticket 6: Fix Custom Router Timeout Handle (High Priority)
**Description:** 
The custom router shell execution in `src/daemon/routers.ts` sets a 10-second timeout, but it doesn't clear this timeout (`clearTimeout`) if the execution finishes (either successfully or with an error) before the timeout expires. This causes the Node.js event loop to stay active longer than necessary, acting as a potential memory leak and blocking process exit.

**Verification:**
- Ensure `clearTimeout` is called on both successful exit and error paths.
- Run the full suite of automated checks: `npm run format:check && npm run lint && npm run check && npm run test`

**Status:** Complete

---

## Ticket 7: Refactor Web API Monolithic Handler (Medium Priority)
**Description:** 
The HTTP server implementation in `src/cli/commands/web.ts` handles all `/api/agents` and `/api/chats` routes within a single, monolithic 300+ line `if/else` block inside the `request` event callback. This violates clear organization and SRP. Also, utility functions like `parseJsonBody` and `sendJsonResponse` are instantiated inside the action scope instead of at the module level.
Extract the route handling into discrete functions (e.g., `handleApiAgents`, `handleApiChats`) and move the utilities outside the `webCmd.action` closure.

**Verification:**
- Verify all web API routes still work via `npm run test` or similar.
- Run the full suite of automated checks: `npm run format:check && npm run lint && npm run check && npm run test`

**Status:** Complete

---

## Ticket 8: Improve Error UX in Agents Web UI (Low Priority)
**Description:** 
In `web/src/routes/agents/+page.svelte`, errors from the API are currently surfaced to the user using the browser's native `alert()` function. This is a poor user experience. Replace `alert()` with a modern approach, such as displaying an inline error message within the modal or form.

**Verification:**
- Simulate an error (e.g., trying to create a duplicate agent) and ensure the error message is displayed within the UI instead of an alert dialog.
- Run the full suite of automated checks: `npm run format:check && npm run lint && npm run check && npm run test`

**Status:** Complete
