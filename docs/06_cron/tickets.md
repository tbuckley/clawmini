# Cron Feature Tickets

## Ticket 1: Core Data Types and Dependencies
**Status:** Completed

**Tasks:**
- Add a robust scheduling library like `node-schedule` (and `@types/node-schedule` if needed) to the project dependencies.
- Update the `ChatSettings` interface/type in `src/shared/workspace.ts` to include an array or record of cron jobs.
- Define the `CronJob` type according to the PRD (properties: `id`, `message`, `reply`, `agentId`, `env`, `session`, `schedule` with `cron`, `every`, or `at`).

**Verification:**
- Ensure the code compiles correctly.
- Run the standard automated checks: `npm run format:check && npm run lint && npm run check && npm run test`

## Ticket 2: Daemon TRPC Endpoints
**Status:** Completed

**Tasks:**
- Implement new TRPC endpoints in the daemon (`src/daemon/router.ts` or relevant router file): `listCronJobs`, `addCronJob`, `deleteCronJob`.
- These endpoints should handle reading and updating the respective chat's `settings.json` file via `src/shared/workspace.ts` functions.

**Verification:**
- Add unit tests for the new TRPC endpoints to ensure they correctly read and write the cron job data to `settings.json`.
- Run the standard automated checks: `npm run format:check && npm run lint && npm run check && npm run test`

## Ticket 3: Daemon Scheduler & Execution Logic
**Status:** Completed

**Tasks:**
- Create a `CronManager` (or similar module) in the daemon (`src/daemon/`).
- Initialize the scheduler on daemon startup by scanning all chats and scheduling active jobs.
- Hook into the TRPC endpoints from Ticket 2 to dynamically schedule/unschedule jobs when they are added or deleted.
- Implement the execution logic for when a job triggers:
  - Formulate the message equivalent of `RouterState`.
  - Execute the message directly, bypassing the standard router pipeline.
  - Handle `session.type === 'new'` by generating a temporary session ID that is not persisted.
  - Automatically remove one-off jobs (scheduled with `at`) from the chat's `settings.json` after successful execution.

**Verification:**
- Write unit tests for the scheduler logic (mocking time/scheduler if necessary) to verify jobs trigger correctly.
- Verify one-off job deletion logic.
- Run the standard automated checks: `npm run format:check && npm run lint && npm run check && npm run test`

## Ticket 4: CLI Commands
**Status:** Completed

**Tasks:**
- Create `src/cli/commands/cron.ts`.
- Implement `clawmini cron list`, `clawmini cron add <name>`, and `clawmini cron delete <name>` commands with all options specified in the PRD.
- Ensure the CLI communicates with the daemon via the TRPC endpoints rather than modifying files directly (if that aligns with the established CLI-Daemon pattern).
- Register the new `cron` command group in `src/cli/index.ts`.

**Verification:**
- Add end-to-end (E2E) tests in `src/cli/e2e/` (e.g., a new `cron.test.ts`) to verify CLI command behavior.
- Run the standard automated checks: `npm run format:check && npm run lint && npm run check && npm run test`

## Ticket 5: Web UI Chat Settings Page
**Status:** Not Started

**Tasks:**
- Create a new settings page route in the SvelteKit frontend: `web/src/routes/chats/[id]/settings/+page.svelte` (or similar logical placement).
- Add a navigation element (like a settings button or 3-dot menu) in the main chat view (`web/src/routes/chats/[id]/+page.svelte`) to access this new page.
- Implement a UI to display existing cron jobs, a form to add new ones, and buttons to delete them, communicating with the daemon via the TRPC client.

**Verification:**
- Add component or E2E tests for the new UI features.
- Run the standard automated checks: `npm run format:check && npm run lint && npm run check && npm run test`
