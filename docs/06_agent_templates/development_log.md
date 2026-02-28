# Development Log: Agent Templates

## Step 1: Update CLI flag parsing for `clawmini agent add`
- [x] Read tickets.md
- [x] Read `src/cli/commands/agents.ts` to see how `agent add` currently works.
- [x] Add the `--template <name>` flag to `clawmini agent add`.
- [x] Update `src/cli/e2e/agents.test.ts` to verify the new flag.
- [x] Run validations and fix any formatting issues.

## Step 2: Implement template resolution and copy logic
- [x] Add `resolveTemplatePath` to `src/shared/workspace.ts` which checks local `.clawmini/templates/` first, and then falls back to `dist/templates/` (using relative path from dist/shared to templates folder).
- [x] Add `copyTemplate` to `src/shared/workspace.ts` to recursively copy template files into the target agent directory if the directory is empty.
- [x] Implement comprehensive unit tests in `src/shared/workspace.test.ts`.
- [x] Run code quality checks (`npm run lint`, `check`, `test`). All pass.

## Step 3: Process template configuration (`settings.json`)
- [x] Wire up `copyTemplate` to the `clawmini agent add` command in `src/cli/commands/agents.ts`.
- [x] Implement logic to read, validate, and process `settings.json` from the newly copied template directory.
- [x] Ensure that the `directory` setting from the template is ignored with a warning and CLI flags correctly override template settings.
- [x] Delete `settings.json` from the agent's working directory after processing.
- [x] Create a dedicated E2E test in `src/cli/e2e/agents.test.ts` to verify the complete `--template` flow.
- [x] Ensure all code quality checks, including Prettier, ESLint, and TypeScript, are passing successfully.

## Bug Fix: Template not found
### Hypotheses
1. `__dirname` resolution is incorrect when running via CLI, pointing to the wrong path.
2. The folder `templates/default` exists but `fsPromises.stat` fails.

### Exploration
By adding debug output to the `Template not found` error, it was clear that `../../templates` was resolving to the project root directory from a depth that was flatter than `src/shared`. Since the bundler output `dist/cli/index.mjs` was flattening the chunk structure, the `__dirname` relative to the bundle entrypoint was pointing directly to `dist/cli` rather than `dist/shared`.

### Resolution
The bug was resolved by updating `resolveTemplatePath` to iterate over several common potential depth paths:
- `__dirname/templates`
- `__dirname/../templates`
- `__dirname/../../templates`

This successfully fixes the bug in the CLI.