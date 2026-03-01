# Product Requirements Document: Agent API

## 1. Vision
Enable sandboxed or containerized agents to securely interact with the host Clawmini daemon. By providing a secure, lightweight web server and a standalone CLI utility (`clawmini-lite`), agents running in environments (e.g., Docker, VMs) without direct access to the host's Unix socket can still perform controlled actions like logging messages or managing cron jobs within their current chat context.

## 2. Product/Market Background
Currently, Clawmini relies on a Unix socket (`.clawmini/daemon.sock`) for communication between the CLI and the daemon. This works perfectly when the agent runs directly on the user's host machine. However, as agents grow more sophisticated, running them in isolated environments like Docker or Podman becomes necessary for security and environment consistency (especially on macOS, where these run inside a VM). These sandboxed agents lose access to the Unix socket and, consequently, the ability to orchestrate tasks via the `clawmini` CLI. 

This feature bridges that gap by exposing a configurable HTTP API for the daemon and providing a portable, zero-configuration utility (`clawmini-lite`) for agents to use.

## 3. Use Cases
*   **Sandboxed Logging:** An agent running in a Docker container needs to log its internal reasoning or tool execution status directly to the user's chat interface (Markdown log).
*   **Job Management:** A containerized agent wants to schedule a follow-up job to check an API in 10 minutes, or it wants to list the active jobs for its chat to manage its state.
*   **Secure Multi-Agent Environments:** An environment where multiple agents are running in separate containers, all needing to communicate status updates back to the host daemon without having root-level access to the system.

## 4. Requirements

### 4.1 Daemon HTTP Server
*   The daemon must optionally start an HTTP server in addition to the Unix socket server.
*   **Configuration (`.clawmini/settings.json`):**
    *   A new `api` key should be added to the global `settings.json`.
    *   `api: false` (default): The web server does not start.
    *   `api: true`: The web server starts on `127.0.0.1` with a default port (e.g., 3000).
    *   `api: { host: "0.0.0.0", port: 8080 }`: The web server starts on the specified host and port.
*   The HTTP server should expose the tRPC router (or a subset of it).

### 4.2 Agent Execution Context & Security
*   When the daemon spawns an agent command (`new` or `append`), it must inject necessary connection details into the process's environment.
*   **Injected Environment Variables:**
    *   `CLAW_API_URL`: The URL of the daemon's HTTP server (if enabled).
    *   `CLAW_API_TOKEN`: A secure, cryptographically signed or encrypted token generated for this specific execution.
*   **Token Payload (`CLAW_API_TOKEN`):**
    *   The token must encode context such as: `chatId`, `agentId`, `sessionId`, and a `timestamp`.
    *   This prevents the agent from interacting with chats or jobs it is not authorized for.
*   **Authentication:** The HTTP server endpoints must validate `CLAW_API_TOKEN` (e.g., via the Authorization header).

### 4.3 `clawmini-lite` Utility
*   A standalone Node.js script (with a shebang `#!/usr/bin/env node`) that serves as a lightweight client for the agent to use inside its sandbox.
*   **Distribution:**
    *   A new CLI command `clawmini export-lite` must be added.
    *   By default, it writes the `clawmini-lite` script to the current directory.
    *   It should support an optional file path argument or a `--stdout` flag to pipe the contents.
*   **Functionality:**
    *   It must automatically detect and use `CLAW_API_URL` and `CLAW_API_TOKEN` from the environment.
    *   It must communicate with the daemon via tRPC over HTTP.
*   **Supported Commands:**
    *   `clawmini-lite log <message>`: Appends a `{type: "log"}` message to the chat's Markdown log.
    *   `clawmini-lite jobs list`: Lists cron jobs for the current chat.
    *   `clawmini-lite jobs add <...>`: Adds a job for the current chat.
    *   `clawmini-lite jobs delete <id>`: Deletes a job from the current chat.
    *   *Note: Commands operate purely within the context defined by `CLAW_API_TOKEN`.*

## 5. Non-Functional Concerns
*   **Security:** By relying on a signed token (`CLAW_API_TOKEN`), we ensure the agent cannot forge context to access or modify data belonging to other chats or agents. The web server should ideally have strict CORS and possibly rate-limiting if exposed widely.
*   **Dependencies:** `clawmini-lite` should ideally have zero external runtime dependencies other than Node.js, so it can run cleanly in minimal Docker images. It can use Node's built-in `fetch` for HTTP requests.
*   **Extensibility:** The API and `clawmini-lite` architecture must be designed to allow adding new commands (like reading chat history or updating agent state) in the future without major refactoring.