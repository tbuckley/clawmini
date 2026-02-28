# Agent Templates Research Notes

## Current Implementation

- `clawmini agent add <id>` is handled in `src/cli/commands/agents.ts`.
  - It currently accepts `--directory` and `--env`.
  - It uses `getAgent` to check existence.
  - It uses `writeAgentSettings(id, agentData)` to persist the configuration, which internally calls `ensureAgentWorkDir(agentId, data.directory, startDir)`.
- `ensureAgentWorkDir` (in `src/shared/workspace.ts`) resolves the directory (either `<workspace-root>/<agent-id>` or the custom directory) and creates it using `fsPromises.mkdir` if it doesn't exist.
- Agent configurations (`AgentSettings` / `AgentSchema`) are stored at `.clawmini/agents/<id>/settings.json`.
- There is a root-level `templates/` folder in the project which might be intended for built-in templates.

## Required Changes

- Add `--template <name>` flag to `clawmini agent add`.
- Define template resolution order:
  1. `.clawmini/templates/<name>`
  2. Built-in template (e.g., `templates/<name>`)
- The copy logic must:
  - Copy the contents of the resolved template folder into the agent's working directory.
  - This should likely occur only when creating the work dir (or if the directory is empty).
  - Look for `settings.json` in the newly copied workdir.
  - If it exists and is valid `AgentSettings` (validates with `AgentSchema`), use it as the base configuration for the agent.
  - Remove `settings.json` from the working directory after using it.
- Flags passed explicitly to `clawmini agent add` (like `--env` or `--directory`) should probably override values from the template's `settings.json`.
