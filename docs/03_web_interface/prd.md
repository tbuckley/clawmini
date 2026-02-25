# PRD: Web Interface for Clawmini (`clawmini web`)

## Vision
The goal is to provide a local, web-based graphical user interface for `clawmini` that runs alongside the CLI. This interface will allow users to comfortably view their active workspaces, chat sessions, and command outputs in a richer, more persistent format than a standard terminal output.

## Product/Market Background
`clawmini` operates as a daemonized local AI agent. While the CLI is fast and scriptable, interpreting long chat histories, comparing multi-turn outputs, or simply managing multiple parallel chats can be cumbersome in a pure terminal environment. A dedicated Web UI bridges this gap, offering the ergonomics of modern web applications without compromising the local, file-based architecture of the CLI. The decision to use SvelteKit and Tailwind/shadcn-svelte aligns with modern rapid prototyping preferences, enabling a high-quality UI while shipping as a static asset.

## Use Cases
1.  **Visual Chat History:** A user wants to review a complex, multi-turn conversation with the agent, complete with distinct visual separation for user messages, daemon logs, and command execution results.
2.  **Live Monitoring:** A user runs a long-running task via the CLI and wants to monitor the agent's progress and thought process in a dedicated browser tab.
3.  **Chat Management:** A user wants to easily switch between different chat sessions (e.g., "feature-x", "bugfix-y") using a visual sidebar without needing to type `clawmini chats list` and `clawmini chats set-default`.
4.  **API Extensibility:** A developer wants to build a custom dashboard that interacts with the `clawmini` local data. The web server must expose clean REST/SSE endpoints.

## Requirements

### Architecture
1.  **Separate Server Process:** The `clawmini web` command will spin up a new Node.js HTTP server. This server runs independently but communicates with the existing `clawmini` daemon (via its UNIX socket) to execute actions.
2.  **Static UI Assets:** The frontend will be a SvelteKit application built using `@sveltejs/adapter-static` with an `index.html` fallback. The compiled assets will be bundled into the CLI package (e.g., `dist/web`) and served statically by the `clawmini web` Node server.
3.  **API Endpoints:** The Node server must expose `/api/*` endpoints to handle data requests from the frontend or third-party tools.
    -   `GET /api/chats` - List available chats.
    -   `GET /api/chats/:id` - Get history for a specific chat.
    -   `POST /api/chats/:id/messages` - Send a new message to the daemon (proxied to the UNIX socket).

### Real-Time Updates (SSE)
1.  **Server-Sent Events:** The server must provide a `GET /api/chats/:id/stream` endpoint.
2.  **File Watching:** This endpoint will use `node:fs` watchers on the respective `.clawmini/chats/:id/chat.jsonl` file. When the file is appended to by the daemon, the server must push the new `ChatMessage` to connected SSE clients.

### User Interface (SvelteKit + TailwindCSS + shadcn-svelte)
1.  **Layout:** A standard two-pane layout:
    -   **Sidebar:** Lists all available chats. Highlights the currently selected chat.
    -   **Main Area:** Displays the message history of the selected chat. Includes a text input area at the bottom to send new messages.
2.  **Message Rendering:** Must differentiate between `UserMessage` and `CommandLogMessage` types visually. Command logs should ideally show standard output/error distinctly.
3.  **Routing:** Standard SPA routing. Hitting `localhost:8080/chats/foo` directly must load the UI and fetch the `foo` chat history.

### Constraints & Considerations
-   **Security:** The web server runs locally. It should bind to `127.0.0.1` (localhost) by default to prevent unauthorized network access unless a specific host flag is provided.
-   **Build Process:** The `package.json` needs to be updated to build the SvelteKit project into a static directory before or alongside the `tsdown` build for the CLI.

## Non-Goals
-   Authentication (it's a local development tool).
-   Cloud syncing of chats (handled by git/filesystem natively if the user chooses).
