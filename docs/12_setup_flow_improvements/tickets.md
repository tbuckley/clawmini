# Implementation Tickets: Setup Flow Improvements

## Ticket 1: Agent Creation Side-effect (Chat Creation)
**Status**: Completed

**Description**:
Update the agent creation process so that when a new agent is added (e.g., via `clawmini agents add <id>`), a corresponding chat with the same `<id>` is automatically created. If the chat is newly created, its `defaultAgent` setting should be assigned to the new agent `<id>`. If a chat with the same `<id>` already exists, do not modify its settings, but instead output a warning indicating the chat existed.

**Tasks**:
- Locate the agent creation logic (likely in `src/cli/commands/agents.ts` or a shared utility).
- Integrate a check to see if a chat with the agent `<id>` exists (e.g., using `src/shared/chats.ts`).
- If it does not exist, create the chat and update its `chat.json` to include `{ defaultAgent: "<id>" }`.
- If it does exist, output a warning to the console.
- Add/update unit tests to cover both the successful chat creation and the existing-chat warning scenarios.

**Verification**:
- Run unit tests for the updated agent creation logic: `npm run test`
- Run type checking: `npm run check`

---

## Ticket 2: Init Command Flags and Agent Initialization
**Status**: Completed

**Description**:
Enhance the workspace initialization command (`clawmini init`) to support bootstrapping a workspace directly with a specific agent and template.

**Tasks**:
- Add `--agent <name>` and `--agent-template <name>` optional flags to the `initCmd` in `src/cli/commands/init.ts`.
- Implement validation: Throw an error if `--agent-template` is provided without the `--agent` flag.
- After standard initialization, if `--agent <name>` is provided, invoke the agent creation logic (from Ticket 1) using the provided name and template (if any).
- Update the workspace's `.clawmini/settings.json` to set the `chats.defaultId` to the newly created agent's `<name>`.
- Add/update unit tests for the `initCmd` to cover flag validation, agent creation invocation, and default chat setting.

**Verification**:
- Run unit tests for the `init` command: `npm run test`
- Run type checking: `npm run check`

---

## Ticket 3: Final Verification
**Status**: Completed

**Description**:
Ensure all code quality checks and tests pass across the entire project.

**Verification**:
- Run formatting check: `npm run format:check`
- Run linting: `npm run lint`
- Run type checking: `npm run check`
- Run all tests: `npm run test`

---

## Ticket 4: Refactor Duplicate Logic in CLI Commands
**Status**: Completed

**Description**:
DRY violation: Agent creation and default chat configuration logic is duplicated between `src/cli/commands/agents.ts` and `src/cli/commands/init.ts`. This logic should be extracted into a shared helper function `createAgentWithChat` in a new file `src/shared/agent-utils.ts`.

**Tasks**:
- Create `src/shared/agent-utils.ts`.
- Extract `createAgentWithChat` helper.
- Update `src/cli/commands/agents.ts` and `src/cli/commands/init.ts` to use it.

---

## Ticket 5: Direct FS write for Chat Settings in `init.ts`
**Status**: Completed

**Description**:
In `src/cli/commands/init.ts`, `settingsPath` is read and written directly via `fs` to update the default chat. This should use workspace config helpers like `setDefaultChatId` from `src/shared/chats.ts`.

**Tasks**:
- Update `src/cli/commands/init.ts` to use `setDefaultChatId`.

---

## Ticket 6: Consistent Error Handling in `init.ts`
**Status**: Completed

**Description**:
Error handling in `src/cli/commands/init.ts` uses `process.exit(1)` directly with `console.error`. `agents.ts` uses a `handleError` function. We should consistently use a shared `handleError` or simply throw an error if appropriate, but since it's a CLI command, maybe create a shared `handleError` in `src/cli/utils.ts` and use it.

**Tasks**:
- Create `src/cli/utils.ts` with `handleError`.
- Update `init.ts` and `agents.ts` to use it.

---

## Ticket 7: Refactor Environment Enable Logic
**Status**: Completed

**Description**:
Extract the environment enablement logic from `src/cli/commands/environments.ts` into a shared utility function so it can be reused by the `init` command.

**Tasks**:
- Extract the `enableEnvironment(name: string, targetPath: string = './')` function to `src/shared/workspace.ts` (or a similar shared location).
- Update `environmentsCmd.command('enable <name>')` to use the extracted function.

**Verification**:
- Run `npm run test` to ensure tests continue to pass.
- Run type checking: `npm run check`.
- Verify the manual `clawmini environments enable` command still works correctly.

---

## Ticket 8: Init Command `--environment` Flag
**Status**: Completed

**Description**:
Enhance the workspace initialization command (`clawmini init`) to support enabling an environment automatically.

**Tasks**:
- Add the `--environment <name>` optional flag to the `initCmd` in `src/cli/commands/init.ts`.
- After standard initialization (writing `.clawmini/settings.json`), if `--environment <name>` is provided, invoke the `enableEnvironment` function (from Ticket 7) with the given name and default path `./`.
- Update unit tests for `initCmd` to cover the new flag and verify the environment enablement logic is called.

**Verification**:
- Run `npm run build && node ./dist/cli/index.js init --environment cladding` on a dummy directory and verify `.clawmini/environments/cladding` exists and `.clawmini/settings.json` has `environments: {"./": "cladding"}` mapped.
- Run unit tests for `initCmd`: `npm run test`.
- Run type checking: `npm run check`.
