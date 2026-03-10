# Sandbox Policies Research Notes

## Current State
- The product (clawmini/Gemini CLI) currently has a daemon that manages chats, messages, agents, and routing.
- Adapters exist for Discord and Web UI.
- CLI handles various commands: agents, chats, environments, jobs, messages.
- There is currently no `sandbox` command in the CLI.

## Feature Requirements
- A `sandbox` CLI available to the agent inside its restricted environment.
- The agent uses this CLI to request user approval for "sensitive actions" that require elevated privileges or network access.
- Requests are asynchronous. AI agents don't block, but scripts/workflows could.
- Examples of actions: 
  - Move files to a read-only network-enabled directory.
  - Send an email.
- The system must capture/snapshot any files related to the request at the time it is made, storing them safely outside the sandbox to prevent tampering while waiting for approval.
- User needs a way to register new commands/actions easily.
- Support for callbacks when the user approves/rejects a request (to notify the agent or trigger a workflow).

## Ambiguities / Open Questions
- Where is the approval surfaced to the user? (Web UI, CLI, Discord?)
- How are actions configured? (YAML, TS, JSON?)
- Where do callbacks execute? (Inside sandbox or outside on host?)
- How does the snapshot mechanism identify which files to capture? (Does the action definition specify file arguments?)

## PR #71 Feedback Notes
- **Constants:** Move max snapshot size limit to a constant.
- **Security:** Ensure snapshots resolve to the *agent's directory*, not just the workspace root. Do not follow symlinks (reject them immediately with lstat). Ensure the generated snapshot filename does not already exist.
- **Router Configuration:** The `slash-policies` router must be an optional router in `init.ts` and loaded dynamically via the pipeline like other routers, not hardcoded.
- **Router State Handling:** Do not use `action: 'stop'` on `/approve` or `/reject` or error cases, as that kills running processes. Instead, use `{ message: '...' }` to update the message the agent sees, and empty message with `reply` for user errors. Include `messageId` for replies.
- **Request Metadata & Validation:** Use shorter, typing-friendly IDs for requests instead of UUIDs. Save `chatId` and `agentId` with the request. Validate the chat ID matches when approving/rejecting. Add Zod validation to `request-store.ts` when loading from disk.
- **Code Cleanup:** Remove inline `await import(...)` in `src/daemon/router.ts` and move them to top-level imports.
- **CLI Commands:** The `request` and `requests` commands should be moved to `src/cli/lite.ts` so they are accessible by the agent.
