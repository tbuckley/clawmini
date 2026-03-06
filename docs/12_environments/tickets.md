# Environments Feature Tickets

## Ticket 1: Configuration Schema and Workspace Utilities
**Status:** Completed
**Description:** Update the shared configuration schemas and utilities to support environments.
**Tasks:**
- Update `SettingsSchema` in `src/shared/config.ts` to include `environments: z.record(z.string(), z.string()).optional()`.
- Create `EnvironmentSchema` in `src/shared/config.ts` to represent `env.json` (`init`, `up`, `down`, `prefix`, `envFormat` as optional strings).
- Add utility functions in `src/shared/workspace.ts` to retrieve the active environment for a given path and to read an environment's `env.json`.
**Verification:**
- Write unit tests for the new utility functions in `src/shared/workspace.test.ts`.
- Run: `npm run format:check && npm run lint && npm run check && npm run test`

## Ticket 2: Environment Templates
**Status:** Completed
**Description:** Create the built-in environment templates and ensure they are ignored by standard agent scaffolding.
**Tasks:**
- Create directory `templates/environments/cladding` and `templates/environments/macos`.
- Add `env.json` to both directories with the required fields outlined in the PRD.
- Ensure any logic listing or copying agent templates ignores `templates/environments/`.
**Verification:**
- Manually verify `clawmini init` does not show `cladding` or `macos` as agent templates.
- Run: `npm run format:check && npm run lint && npm run check && npm run test`

## Ticket 3: CLI Commands (`environments enable` and `disable`)
**Status:** Completed
**Description:** Implement the `clawmini environments` CLI command group.
**Tasks:**
- Create `src/cli/commands/environments.ts`.
- Implement `enable <name> [--path <subpath>]`: 
  - Validate `<name>` exists in templates.
  - Copy template to `.clawmini/environments/<name>` if it doesn't exist.
  - Update `.clawmini/settings.json` with the new environment mapping (default path `./`).
  - Execute the `init` command from `env.json`.
- Implement `disable [--path <subpath>]`:
  - Remove the mapping from `.clawmini/settings.json`.
- Register the `environments` command in `src/cli/index.ts` or where CLI commands are registered.
**Verification:**
- Execute Test Flow 1 from `prd.md` (Enabling and Disabling Environments).
- Run: `npm run format:check && npm run lint && npm run check && npm run test`

## Ticket 4: Daemon Lifecycle Hooks
**Status:** Completed
**Description:** Execute environment `up` and `down` commands during daemon startup and shutdown.
**Tasks:**
- Update the daemon startup logic to find all enabled environments in the workspace and execute their `up` commands.
- Update the daemon shutdown logic to execute all enabled environments' `down` commands.
**Verification:**
- Execute Test Flow 2 from `prd.md` (Daemon Lifecycle Hooks).
- Run: `npm run format:check && npm run lint && npm run check && npm run test`

## Ticket 5: Command Wrapping in Daemon
**Status:** Completed
**Description:** Wrap agent commands with the environment prefix before execution.
**Tasks:**
- Update `src/daemon/message.ts` (specifically where commands are executed).
- Determine the active environment by finding the most specific path match for `executionCwd`.
- If active, read its `env.json`.
- Construct `{ENV_ARGS}` using the agent's environment variables and the `envFormat`.
- Replace `{WORKSPACE_DIR}`, `{AGENT_DIR}`, `{ENV_DIR}`, `{HOME_DIR}`, and `{ENV_ARGS}` in the `prefix` string.
- Execute the newly prefixed command instead of the raw command.
**Verification:**
- Write unit tests for the prefix resolution logic.
- Execute Test Flow 3 from `prd.md` (Command Wrapping and Variables).
- Execute Test Flow 4 from `prd.md` (Environment Specificity).
- Run: `npm run format:check && npm run lint && npm run check && npm run test`