# Tickets: Web Interface (`clawmini web`)

In general, prefer shadcn-svelte UI components when they exist.

## Step 1: Initialize SvelteKit Frontend

- **Description:** Scaffold a new SvelteKit project (e.g., in a `web/` directory) configured with `@sveltejs/adapter-static` and an `index.html` fallback. Set up TailwindCSS and shadcn-svelte. Update the root `package.json` to include a build script that compiles the SvelteKit app and outputs the static assets to `dist/web`.
- **Verification:**
  - Running `npm run build` at the root successfully generates `dist/web/index.html`.
  - All standard checks pass: `npm run format:check && npm run lint && npm run check && npm run test`.
- **Status:** Complete

## Step 2: Implement `clawmini web` Command & Static Server

- **Description:** Create the `src/cli/commands/web.ts` command. Implement a local Node.js HTTP server that binds to `127.0.0.1` (with a configurable `--port` flag, defaulting to 8080). Configure the server to serve static files from `dist/web` and fallback to `dist/web/index.html` for unknown routes (to support SPA routing).
- **Verification:**
  - Add a CLI test that runs `clawmini web --port 8080` in the background, curls `http://127.0.0.1:8080/`, and asserts a 200 OK response containing the HTML.
  - All standard checks pass: `npm run format:check && npm run lint && npm run check && npm run test`.
- **Status:** Complete

## Step 3: Implement REST API Endpoints

- **Description:** Add routing logic to the Node.js server for `/api/*`. Implement `GET /api/chats` (list chats), `GET /api/chats/:id` (get chat history), and `POST /api/chats/:id/messages` (send a message to the daemon via the UNIX socket using the existing tRPC client).
- **Verification:**
  - Add integration tests for the new HTTP API endpoints to verify they correctly read from the file system and forward messages to the daemon.
  - All standard checks pass: `npm run format:check && npm run lint && npm run check && npm run test`.
- **Status:** Complete

## Step 4: Implement Server-Sent Events (SSE) Endpoint

- **Description:** Implement `GET /api/chats/:id/stream` in the web server. Use `node:fs` to watch the corresponding `.clawmini/chats/:id/chat.jsonl` file. Push new messages as Server-Sent Events to connected clients and ensure watchers are properly cleaned up on disconnect.
- **Verification:**
  - Write a test that connects to the SSE endpoint, simulates a daemon appending a message to the `chat.jsonl` file programmatically, and verifies the event is received.
  - All standard checks pass: `npm run format:check && npm run lint && npm run check && npm run test`.
- **Status:** Complete

## Step 5: Frontend UI - Layout & Sidebar

- **Description:** In the SvelteKit app, build the main two-pane layout. Use the shadcn-svelte sidebar component to fetch and display the list of available chats from `GET /api/chats`. Add client-side routing to navigate to `/chats/:id` and visually highlight the active chat.
- **Verification:**
  - Add basic component/unit tests in the SvelteKit project to ensure the sidebar renders a mock list of chats correctly.
  - All standard checks pass: `npm run format:check && npm run lint && npm run check && npm run test`.
- **Status:** Complete

## Step 6: Frontend UI - Chat Pane & Message Input

- **Description:** Implement the Main Area of the UI. Fetch and display the message history for the selected chat from `GET /api/chats/:id`. Differentiate visually between `UserMessage` and `CommandLogMessage` (e.g., standard output vs. standard error). Add a text input to post new messages via `POST /api/chats/:id/messages`.
- **Verification:**
  - Add component tests to verify that `UserMessage` and `CommandLogMessage` are rendered with distinct visual styles.
  - All standard checks pass: `npm run format:check && npm run lint && npm run check && npm run test`.
- **Status:** Not started

## Step 7: Frontend UI - SSE Integration

- **Description:** Connect the SvelteKit frontend to the `GET /api/chats/:id/stream` endpoint using the `EventSource` API. Automatically append new messages to the chat history in real-time as they arrive. Implement basic auto-scrolling to the latest message.
- **Verification:**
  - Add a test or mock simulating an SSE message arrival and verify the UI state updates to include the new message.
  - All standard checks pass: `npm run format:check && npm run lint && npm run check && npm run test`.
- **Status:** Not started
