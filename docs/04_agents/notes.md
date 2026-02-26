# Notes on Agents Feature

## Current State

- `settings.json` in the workspace root (`.clawmini/settings.json`) currently contains a `defaultAgent` object with the schema:
  ```json
  {
    "defaultAgent": {
      "commands": {
        "new": "...",
        "append": "...",
        "getSessionId": "...",
        "getMessageContent": "..."
      },
      "env": {
        "KEY": "VALUE"
      }
    }
  }
  ```
- Each chat has its own `settings.json` at `.clawmini/chats/<chatId>/settings.json`, which currently just maps a `defaultAgent` string to a session ID (wait, it just has `defaultAgent` pointing to an agent id as a string, e.g., `"defaultAgent": "my-agent"` or `"defaultAgent": "default"`. Let's verify this.)
- Actually, `message.test.ts` shows `defaultAgent: 'my-agent'`.

## Proposed Agents Feature
- We need a `clawmini agents` command group with `add`, `delete`, `list`.
- Agents will be stored at `.clawmini/agents/<id>/settings.json`.
- The configuration structure for an agent in `.clawmini/agents/<id>/settings.json` will mirror the `defaultAgent` config, plus a new `directory` key:
  ```json
  {
    "commands": { ... },
    "env": { ... },
    "directory": "./<agent_name>"
  }
  ```
- Agent settings will act as overrides/extensions over the main `settings.json`'s `defaultAgent`.
- `directory` will be used as the `cwd` when executing the agent's commands. It's either absolute or relative to the workspace root (parent of `.clawmini`).
- The `clawmini messages send` command should get an `--agent <id>` flag to set the agent for a chat.
- UI changes: The web UI should let users select the default agent when creating a chat. The web UI needs to create new agents as well.

## Findings from Code
- `src/shared/config.ts` will need to be updated to support an `Agent` schema.
- `src/daemon/message.ts` (the daemon message handler) will need to be updated to merge the selected agent's config with the workspace's `defaultAgent` config and use the agent's `directory` as `cwd`.
- The `src/cli/commands/messages.ts` will need an `--agent` flag that updates the chat's settings to use the specified agent, via `writeChatSettings` in `src/shared/workspace.ts`.
- The UI is built with SvelteKit. We'll need a new route/dialog to create agents, and a way to choose an agent when creating a chat.
- UI API endpoints: we'll probably need `/api/agents` to list and create agents, and `/api/agents/:id` to manage them.
