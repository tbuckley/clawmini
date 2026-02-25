# Notes on Web Interface Feature

## Current Architecture
- `clawmini` is a CLI tool that runs a background daemon (`src/daemon/index.ts`).
- Communication with the daemon currently happens over a UNIX socket via `tRPC` (`@trpc/server/adapters/standalone`).
- Chat data is persisted in a local directory structure: `.clawmini/chats/<chat_id>/chat.jsonl`.
- `src/shared/chats.ts` provides file-system utilities for reading/writing `ChatMessage`s (`UserMessage` or `CommandLogMessage`).

## Web Interface Concept
- A new command: `clawmini web` which will spawn an HTTP web server on a local TCP port (e.g., 8080).
- **Backend (API)**:
  - Needs to expose API endpoints for a generic Web UI to connect to.
  - Can read the file system directly using `src/shared/chats.ts` functions or forward actions to the daemon via the existing tRPC socket (to execute commands, etc.).
  - Real-time updates ("pushed any new messages when they arrive") will require either Server-Sent Events (SSE) or WebSockets. File watching (`chokidar` or `fs.watch`) on `chat.jsonl` files or tapping into the daemon's tRPC events can provide the trigger.
- **Frontend (UI)**:
  - Basic layout: Sidebar (list of chats), Main pane (Chatbox, list of messages).
  - Must be served essentially as a "static" site. If the user hits `localhost:8080/chats/foo`, the server should serve the `index.html` fallback (SPA routing) so the frontend router handles the display.
  - SvelteKit is preferred by the user. SvelteKit's `adapter-static` enables building an SPA that fits exactly this requirement (static files with client-side routing and fallbacks).

## Technology Choices & Integration
1.  **Frontend Framework**:
    - **Svelte/SvelteKit** (Preferred): Excellent for small, reactive apps. We can build it as an SPA using `@sveltejs/adapter-static` with `fallback: 'index.html'`. The compiled output (HTML/JS/CSS) can be bundled into the `dist/web` directory when the CLI is built, and `clawmini web` will just serve these static files using a basic node server.
    - **Vanilla/Web Components**: Easiest integration (no build step for the CLI besides basic TS compilation), but higher development cost for reactive features and UI components.
    - **React (Vite)**: Similar to SvelteKit, requires a separate build step.
2.  **API / HTTP Server**:
    - We could use a lightweight web framework like `Express`, `Hono`, or `Fastify` for the `clawmini web` server.
    - The server will serve the Svelte static files AND expose `/api/*` routes.
3.  **Real-time Updates**:
    - Server-Sent Events (SSE) over HTTP is simpler to implement than WebSockets since it works over standard HTTP without additional upgrade logic, perfect for a one-way "push" of new messages.
