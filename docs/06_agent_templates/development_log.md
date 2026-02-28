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
