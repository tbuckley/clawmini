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
