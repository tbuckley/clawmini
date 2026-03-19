# Product Requirements Document: Blocking Lite Request

## 1. Vision
Streamline the usage of `clawmini-lite.js request <cmd>` in automated scripts and continuous workflows by making the command block until a human reviews and approves (or rejects) the request. This eliminates the need for external scripts to build custom polling or waiting logic, ensuring seamless execution synchronization.

## 2. Product/Market Background
Currently, when a request requiring human approval is made via `clawmini-lite.js`, the command exits immediately with exit code `0` and simply prints the Request ID to the console. While this is fine for asynchronous, detached tasks, it makes scripting difficult because the script cannot easily wait for the side-effect (the policy execution) to complete. By making the CLI block, we align its behavior with standard synchronous CLI tools, improving the developer experience.

## 3. Use Cases
1. **Synchronous Scripted Workflows**: A bash script executes `clawmini-lite.js request db-migrate`. The script naturally pauses. A developer reviews the preview in their chat interface (Discord/Web) and replies with `/approve`. The `request` command then completes, prints the migration output, and exits with the proper status code, allowing the script to safely proceed.
2. **Asynchronous/Detached Execution**: A developer runs `clawmini-lite.js request long-task --no-wait`. The command immediately returns the Request ID and exits, allowing the user to continue typing other commands while the request sits in the pending queue.
3. **Rejection Handling**: A user rejects a risky operation via `/reject [reason]`. The blocked `request` command receives the `Rejected` state, logs the reason, and exits with code `1`, halting any dependent scripts.

## 4. Requirements

### 4.1 CLI Behavior Changes
- `clawmini-lite.js request <cmd>` MUST block indefinitely by default if the policy requires manual approval.
- While blocking, the CLI SHOULD print a visual indicator (e.g., "Waiting for approval for request {id}...").
- The CLI MUST poll the daemon for the request status at a fixed interval (e.g., every 2 seconds).
- Upon state transitioning to `Approved`: The CLI MUST print the `stdout` and `stderr` of the executed policy and exit with the corresponding `exitCode`.
- Upon state transitioning to `Rejected`: The CLI MUST print the rejection reason and exit with a non-zero exit code (e.g., `1`).
- If the policy is configured with `autoApprove: true`, the CLI MUST NOT block (maintaining current immediate execution behavior).

### 4.2 New CLI Options
- Add a `--no-wait` boolean option to the `request` command.
- If `--no-wait` is provided, the CLI MUST fall back to the existing behavior: print the Request ID and exit immediately with code `0`.

### 4.3 Daemon/API Updates
- Add a new tRPC query procedure to `AgentRouter` (e.g., `getPolicyRequest`).
- **Input**: `{ id: string }`
- **Output**: `PolicyRequest | null`
- **Implementation**: The procedure will use the existing `RequestStore.load(id)` to retrieve and return the current state of the request.

## 5. Security, Privacy, and Accessibility Concerns
- **Security**: No new security risks. The approval mechanism remains securely on the daemon side within the chat sessions. The CLI only polls for state changes.
- **Privacy**: No new PII is collected or exposed.
- **Accessibility**: The waiting loop should rely on standard `stdout` printing and gracefully handle `SIGINT` (`Ctrl+C`) so the user can easily abort the blocking wait without killing the actual request on the daemon side.
