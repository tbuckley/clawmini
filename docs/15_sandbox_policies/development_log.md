# Development Log

## Ticket 1: Core Configuration and Request State Management
Starting implementation of Ticket 1.

**Notes:**
- Created `src/shared/policies.ts` defining `PolicyConfig`, `PolicyDefinition`, `PolicyRequest`, and `RequestState`.
- Implemented `RequestStore` in `src/daemon/request-store.ts` to manage requests persistently under `.clawmini/tmp/requests`.
- Added unit tests for `RequestStore` covering normal operations and graceful handling of corrupted JSON files.
- Ensured all tests, types, and formatting pass. Ticket 1 is complete.

## Ticket 2: File Snapshotting and Security Layer
**Notes:**
- `src/daemon/policy-utils.ts` and `src/daemon/policy-utils.test.ts` implement snapshotting, argument interpolation, and safe execution.
- Verified test coverage and passed formatting/linting checks.
- Ticket 2 is complete.

## Ticket 3: Daemon Request Service
**Notes:**
- Created `src/daemon/policy-request-service.ts` and `src/daemon/policy-request-service.test.ts`.
- The service enforces maximum limit of pending requests (100).
- Handled snapshot generation for mapping file paths using `createSnapshot`.
- Stored requested payloads via `RequestStore`.
- Authored passing unit tests for request creation, rejection (on threshold), and argument interpolation handling.
- Ensured all codebase formatting, linting, and tests passed via the required checks.
- Ticket 3 is complete.
## Ticket 4: CLI Agent Commands
**Notes:**
- Implemented `clawmini requests list` to view available policies.
- Implemented `clawmini request <cmd> [--help] [--file name=path] -- [args]` to spawn policies or send them as requests to the daemon.
- Added `listPolicies` and `createPolicyRequest` to the daemon's AppRouter.
- Handled Commander's excess argument parsing correctly to allow passing opaque arguments without errors.
- Created `src/cli/e2e/requests.test.ts` which tests the entire flow successfully.
- Ticket 4 is complete.

## Ticket 5: Chat UI Routing and User Slash Commands
**Notes:**
- Implemented `slashPolicies` router in `src/daemon/routers/slash-policies.ts` to process user messages directly.
- The router acts as an interceptor for `/approve <id>`, `/reject <id> [reason]`, and `/pending` commands.
- It guarantees strict spoofing prevention by being integrated natively into the router pipeline via `executeRouterPipeline` which strictly evaluates user inputs (`role: 'user'`).
- In `src/daemon/router.ts`, updated `createPolicyRequest` to generate and append a preview message inside the chat when requests are generated.
- The preview correctly abbreviates snapshotted file contents to 500 characters and handles failures safely.
- Wrote full unit test coverage for the preview message and the slash command router spoofing prevention mechanisms.
- Verified test suite and all quality checks successfully passed (`npm run format:check && npm run lint && npm run check && npm run test`).
- Ticket 5 is complete.

## Ticket 6: Execution and Feedback Loop
**Notes:**
- Implemented execution logic inside `src/daemon/routers/slash-policies.ts` for `/approve`.
- It dynamically reads the corresponding policy configuration, interpolates all arguments (both policy args and opaque user args) via `interpolateArgs`, and spawns the safe child process wrapper (`executeSafe`).
- Integrated automated system log messages. Upon resolving the request (approving or rejecting), a `CommandLogMessage` is constructed and injected into the target chat via `appendMessage` so the agent receives the feedback (`stdout`/`stderr` for approvals, rejection reason for rejections).
- Fixed unused variable lint error and unexpected any warnings in `src/daemon/router-policy-request.test.ts`.
- Added complete coverage unit tests for the `/approve` and `/reject` flows within `src/daemon/routers/slash-policies.test.ts`.
- All checks (`npm run format:check && npm run lint && npm run check && npm run test`) pass. Ticket 6 is complete.

## Ticket 8: Policy Utils Improvements
**Notes:**
- Exported `MAX_SNAPSHOT_SIZE` constant (5MB) in `src/daemon/policy-utils.ts` and enforced its usage.
- Refactored `createSnapshot` to receive `agentDir` instead of `workspaceRoot`.
- Enforced strict symlink rejection by replacing `fs.realpath` with `fs.lstat` during snapshot creation, rejecting any symlinks to avoid TOCTOU attacks.
- Modified the snapshot logic to guarantee unique filenames by leveraging `fs.constants.COPYFILE_EXCL` within a retry loop to prevent silent overwrites.
- Updated `PolicyRequestService` and the `createPolicyRequest` router TRPC procedure to retrieve and pass `agentDir`.
- Fully updated and expanded `policy-utils.test.ts` to assert against symlink rejection and new size limit constants.
- Successfully ran all tests, including formatting, linting, type checks, and full unit test suites. Ticket 8 is complete.

## Ticket 9: Policy Request Metadata & Validation Enhancements
**Notes:**
- Updated request ID generation to use a 3-character random alphanumeric string using `crypto.randomBytes`.
- Added `chatId` and `agentId` to `PolicyRequest` and properly populated them inside `createRequest` via `src/daemon/router.ts`.
- Implemented `PolicyRequestSchema` utilizing Zod within `request-store.ts` to validate disk reads dynamically.
- Handled mock tests properly in `policy-request-service.test.ts`, `router-policy-request.test.ts`, and `request-store.test.ts` adapting to the new metadata fields.
- Successfully executed formatting, linting, unit tests, and integration tests (`npm run format`, `npm run lint:fix`, `npm run check`, `npm run test`).
- Ticket 9 is complete.

## Ticket 10: Router State & Configuration Fixes
**Notes:**
- Updated `src/daemon/routers.ts` to execute `slash-policies` dynamically as part of the router pipeline loop, removing hardcoded top-level logic.
- Extended `RouterState` interface in `src/daemon/routers/types.ts` to explicitly include `messageId` tracking the user's incoming message ID.
- Passed `messageId` properly down to the state configuration within `src/daemon/message.ts` via `getInitialRouterState` and `handleUserMessage`.
- Modified `src/daemon/routers/slash-policies.ts` so that `/approve`, `/reject`, and error flows no longer force an abrupt `action: 'stop'`. 
- Ensured errors update `state.reply` with `state.message` cleared, while correct executions update `state.message` safely.
- Validated `req.chatId` matches the incoming request context to prevent unauthorized cross-chat executions.
- Updated all unit tests across the test suite to include mock `messageId` and adapted the modified assertions for success and error behaviors.
- All code checks format, lint, tests compiled correctly and successfully passed without exceptions.
- Ticket 10 is complete.