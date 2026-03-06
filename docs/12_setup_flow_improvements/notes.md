# Notes: Setup Flow Improvements

## Codebase Findings

- `src/cli/commands/init.ts` handles the initialization of the workspace by creating `.clawmini/settings.json`. It currently takes no arguments related to agents.
- `src/cli/commands/agents.ts` has the `add <id>` command. It currently calls `writeAgentSettings(id, ...)` and `applyTemplateToAgent(...)`. It doesn't interact with chats.
- `src/shared/chats.ts` contains `createChat(id)` for initializing a chat directory, and `setDefaultChatId(id)` to update the workspace default chat.
- `src/shared/workspace.ts` has `readChatSettings` and `writeChatSettings` which manage `chat.json` within a chat's directory.
- `src/shared/config.ts` defines `ChatSettings` with an optional `defaultAgent` string field.
- Workspace settings (`SettingsSchema`) has `defaultAgent` (which is a base `Agent` configuration object, not an ID reference) and `chats.defaultId` (which points to the default chat ID).

## Implementation Plan

1. **Agent Creation side effect**: Update the logic of `agents add` (specifically in `src/cli/commands/agents.ts` or as a reusable function) to:
   - Check if a chat with the agent's ID exists.
   - If it doesn't exist, create it via `createChat(id)`.
   - Update the chat's `chat.json` settings by adding `{ defaultAgent: id }` via `writeChatSettings(id, ...)` (merging if `chat.json` already exists).

2. **Init Command Flags**: Add `--agent <name>` and `--agent-template <name>` flags to `initCmd` in `src/cli/commands/init.ts`.
   - After writing `.clawmini/settings.json`, invoke the agent creation logic using these flags. We will reuse the core logic from `agents add` by extracting it to a shared function or simply calling the workspace functions (`writeAgentSettings`, `applyTemplateToAgent`, plus the new chat creation logic).

## New Feature: `--environment` Flag on `init`

### Codebase Findings
- The `environments enable <name>` command logic is currently tightly coupled to the commander action in `src/cli/commands/environments.ts`.
- It performs the following:
  1. Copies the environment template via `copyEnvironmentTemplate`.
  2. Updates `.clawmini/settings.json` with the new environment mapping.
  3. Executes the environment's `init` command if defined in `env.json`.
- `initCmd` in `src/cli/commands/init.ts` handles workspace initialization.

### Implementation Plan
- Extract the environment enablement logic into a shared utility function, e.g., `enableEnvironment(name: string, targetPath: string = './')` in `src/shared/environments.ts` or `src/shared/workspace.ts`.
- `initCmd` will parse the `--environment` flag and call `enableEnvironment(options.environment)` after creating `.clawmini/settings.json`.
