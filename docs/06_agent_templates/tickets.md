# Agent Templates Tickets

## Step 1: Update CLI flag parsing for `clawmini agent add`
- **Description:** Add the `--template <name>` flag to the `clawmini agent add` command. Ensure it correctly parses alongside existing flags like `--directory` and `--env`.
- **Verification:** 
  - Update or add tests in `src/cli/e2e/agents.test.ts` to verify the `--template` flag is parsed and passed to the handler correctly.
  - Run `npm run format:check && npm run lint && npm run check && npm run test`.
- **Status:** Completed

## Step 2: Implement template resolution and copy logic
- **Description:** 
  - Implement a function to resolve the template path, checking `.clawmini/templates/<name>` first, then falling back to a built-in `templates/<name>` folder relative to the built CLI executable.
  - Add logic to check if the target agent working directory exists and is **not empty**. If it is not empty, the command must fail to prevent overwriting.
  - Recursively copy the contents of the resolved template folder into the new agent's working directory.
- **Verification:** 
  - Add unit tests verifying correct resolution order (local workspace vs. built-in), successful file copying to an empty directory, and failure when the target directory is not empty.
  - Verify that built-in templates are correctly resolved from the compiled `dist/` directory.
  - Run `npm run format:check && npm run lint && npm run check && npm run test`.
- **Status:** Not started

## Step 3: Process template configuration (`settings.json`)
- **Description:** 
  - After copying the template files, check for a `settings.json` in the newly created agent working directory.
  - If present, read and validate it against `AgentSchema`.
  - If the template's `settings.json` includes a `directory` field, ignore it, print a warning to the user, and use the default `./<agent-id>` or the one provided by `--directory`.
  - Merge the configuration: CLI flags (`--env`, `--directory`) MUST override values from the template's `settings.json`.
  - Remove the `settings.json` file from the agent's working directory after processing.
  - Pass the resulting merged configuration to `writeAgentSettings`.
- **Verification:** 
  - Add unit tests for the configuration merging logic, ensuring CLI flags override template settings and that the `directory` field in the template is ignored with a warning.
  - Verify `settings.json` is deleted from the working directory after creation.
  - Add/update an end-to-end test in `src/cli/e2e/agents.test.ts` for `clawmini agent add <id> --template <name>` simulating the entire flow.
  - Run `npm run format:check && npm run lint && npm run check && npm run test`.
- **Status:** Not started
