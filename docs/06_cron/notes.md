# Cron Feature Notes

## Research Findings
- CLI commands are structured in `src/cli/commands/`. We will add a new `cron.ts` command and register it in `src/cli/index.ts`.
- The Daemon uses TRPC for communication (`src/daemon/router.ts`). We'll need to add endpoints like `addCronJob`, `deleteCronJob`, `listCronJobs` to `AppRouter` or manage it directly via reading/writing files depending on the architecture. However, since the Daemon runs the jobs, the TRPC router will likely need a `reloadCronJobs` or similar method, or the daemon manages its own scheduler state.
- Per-chat settings are managed in `src/shared/workspace.ts` (`readChatSettings`, `writeChatSettings`), which stores them in `.clawmini/chats/<chatId>/settings.json`.
- `RouterState` is defined in `src/daemon/routers/types.ts`. Cron jobs will define properties similar to this state: `message`, `chatId`, `agentId`, `sessionId`, `env`, `reply`.
- Bypassing routers: `handleUserMessage` currently executes the router pipeline. We can either add a `bypassRouters: true` flag to `handleUserMessage` or provide a more direct `executeMessage` function.
- Web UI uses SvelteKit (`web/src/routes/chats/[id]/+page.svelte`). It communicates via TRPC. We'll need to add UI for managing cron jobs.

## Technical Plan
- **Scheduler**: The daemon (`src/daemon/index.ts`) will need a CronManager that starts when the daemon starts, reads all chat settings, and schedules jobs.
- **Dependencies**: Parsing crontab strings (`--cron`) will likely require a library unless we build a parser.
- **`--new-session`**: Requires adding a `newSession: boolean` property to `RouterState` or passing it directly to the daemon's message handler so it doesn't preserve the `sessionId`.