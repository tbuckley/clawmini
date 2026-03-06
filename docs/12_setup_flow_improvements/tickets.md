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
**Status**: Not Started

**Description**:
Ensure all code quality checks and tests pass across the entire project.

**Verification**:
- Run formatting check: `npm run format:check`
- Run linting: `npm run lint`
- Run type checking: `npm run check`
- Run all tests: `npm run test`
