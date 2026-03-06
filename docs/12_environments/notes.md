# Environments Feature Notes

## Objective
Add an "environments" feature to `clawmini`, primarily for sandboxing. Users interact with it via `clawmini environments`.

## Key Concepts
- Environments provide a way to wrap agent commands with sandboxing or other execution contexts.
- Built-in templates: `cladding` and `seatbelt` (`macos`).
- Users enable environments for specific paths within the workspace.
- The environment configuration is stored in `.clawmini/settings.json` under `environments`.
- Environments can have `up` and `down` commands executed when `clawmini up`/`clawmini down` are run.
- When an agent command is run, the daemon finds the most specific environment for the agent's directory, gets the environment's prefix, and wraps the command.

## Environment: Cladding
Setup:
1. Run `cladding init`
2. Run `clawmini export-lite` in the `.cladding/tools/bin` folder
3. Potentially replace files in `.cladding`
4. Run `cladding up`

Command Wrapping:
- Prefix agent commands with: `cladding run --env $CLAWMINI_API_URL --env $CLAWMINI_API_TOKEN` (plus other env vars).

## Environment: MacOS (Seatbelt)
Setup:
1. Provide a `.sb` file (e.g., `.clawmini/environments/macos/sandbox.sb`) defining the profile.

Command Wrapping:
- Prefix agent commands with `sandbox_exec -f <profile_path>`, passing relevant directories as env vars (`$HOME_DIR`, `$WORKSPACE_DIR`, `$AGENT_DIR`, `$ENV_DIR`, `$CONFIG_DIR`).

## CLI Commands
- `clawmini environments enable <name> [--path <subpath>]`
  - Creates `.clawmini/environments/<name>` from template if it doesn't exist.
  - Registers `{"environments": {"<subpath>": "<name>"}}` in `.clawmini/settings.json`.
  - Calls initialization commands.
- `clawmini environments disable [--path <subpath>]`
  - Removes registration from `.clawmini/settings.json`.
- `clawmini up` / `clawmini down`
  - Calls up/down commands for enabled environments.

## Integration Points
- `src/shared/config.ts`: Add `environments: z.record(z.string(), z.string()).optional()` to `SettingsSchema`. Also perhaps define how environments are configured (e.g., `EnvironmentSchema` for `up`/`down`/`prefix` commands). Where is the environment definition stored? E.g. `.clawmini/environments/<name>/env.json`?
- `src/cli/commands/up.ts` & `src/cli/commands/down.ts`: Need to iterate over enabled environments and run their up/down commands.
- `src/daemon/message.ts`: In `executeDirectMessage`, before `runCommand`, resolve the environment based on `executionCwd` and apply the prefix.
- `src/cli/commands/environments.ts`: New CLI command.
