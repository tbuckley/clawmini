# Agent API Notes

## Current State

- The daemon uses a tRPC server over a Unix socket (`.clawmini/daemon.sock`) to communicate between the CLI and the daemon.
- When an agent is run, the daemon uses `spawn` to run shell commands (like `new` or `append`). It passes arguments securely via environment variables (e.g., `CLAW_CLI_MESSAGE`).
- Agents running on the same host can just use the `clawmini` CLI (e.g., `clawmini jobs list`), as the CLI automatically finds the Unix socket.
- The `clawmini` CLI interacts with the Unix socket by configuring a `http` proxy to the socket file.

## The Problem

- Agents may be sandboxed (e.g., running in Docker/Podman, potentially inside a VM on macOS).
- Sandboxed agents might not have direct access to the `.clawmini/daemon.sock` Unix socket file, meaning they cannot just run the `clawmini` CLI command to orchestrate changes.
- Furthermore, giving a sandboxed agent full access to the Unix socket means the agent could arbitrarily execute commands on the host by exploiting the `sendMessage` daemon endpoint.

## Proposed Solution

- **Web Server:** The daemon should optionally expose an HTTP server bound to a user-defined host/port (e.g., `127.0.0.1:3000` or `0.0.0.0:3000`). This can be configured in `.clawmini/settings.json`.
- **Authentication/Context:** When the daemon spawns an agent command, it should inject new environment variables, such as:
  - `CLAW_CHAT_ID`: To identify which chat the agent belongs to.
  - `CLAW_AGENT_ID`: To identify the agent.
  - `CLAW_API_URL`: The URL of the web server (e.g., `http://host.docker.internal:3000`).
  - `CLAW_API_TOKEN` (optional but recommended): A dynamically generated bearer token for the current execution to securely authenticate the agent back to the host.
- **`clawmini-lite`:** Create a single, lightweight bash/sh script (`clawmini-lite`) that can be mounted or downloaded into the sandbox. This script will make standard `curl` requests to the HTTP server using the injected environment variables.
- **Allowed Capabilities:** The HTTP server should only expose a restricted subset of endpoints (like appending to a chat log or manipulating jobs), ensuring the agent cannot execute arbitrary commands on the host.

## Relevant Code
- `src/daemon/index.ts`: Initialization of the Unix socket HTTP server.
- `src/daemon/router.ts`: The tRPC appRouter. We can use the same router or expose a subset for the external web server.
- `src/shared/config.ts`: `SettingsSchema` will need to be updated to support something like `server: { host: string, port: number }`.
- `src/daemon/message.ts`: Where the environment variables are injected (`CLAW_CLI_MESSAGE`). We'll need to add `CLAW_CHAT_ID`, `CLAW_API_URL`, etc.