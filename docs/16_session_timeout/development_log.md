# Development Log

## Step 1: Extend RouterState Interface
- Added `import type { CronJob } from '../../shared/config.js';` to `src/daemon/routers/types.ts`.
- Extended `RouterState` interface with `nextSessionId` and `jobs: { add?: CronJob[], remove?: string[] }`.
- Validating the type changes.

## Step 2: Update Daemon Message Pipeline
- Modified `src/daemon/message.ts` to process `finalState.jobs` and `finalState.nextSessionId`.
- Scheduled and unscheduled jobs via `cronManager`.
- Updated active session when `nextSessionId` is present.
- Added tests in `src/daemon/message-jobs.test.ts` to verify functionality.
## Step 3: Implement `@clawmini/session-timeout` Router
- Created `src/daemon/routers/session-timeout.ts` export `createSessionTimeoutRouter`.
- Configured to run on schedule (cron 'every Xm') matching `config.timeoutMinutes`.
- Removed timeout job when handling the triggered timeout message.
- Re-scheduled the job on standard user messages.
- Handled rotation of `nextSessionId` correctly upon timeout.
- Added corresponding tests inside `src/daemon/routers/session-timeout.test.ts`.
- Validated with `npm run validate`.
