# Development Log

## Initialization
- Started working on "Step 1: Update Agent Schema".
- Added `apiTokenEnvVar` and `apiUrlEnvVar` to `AgentSchema` in `src/shared/config.ts`.
- Ran `npm run format && npm run lint:fix && npm run validate`.
- Validations failed initially due to zombie processes on the e2e test port, so killed zombie node and daemon processes and retried successfully.
- Marked Step 1 as completed in `tickets.md`.