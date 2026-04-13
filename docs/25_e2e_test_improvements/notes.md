# E2E Test Improvements Research Notes

## Current State of E2E Tests
- The e2e tests are located in `src/cli/e2e/`.
- They use Vitest.
- `global-setup.ts` runs `npm run build` once before all tests.
- `utils.ts` provides `createE2EContext` which creates isolated test directories (e.g., `e2e-policy-flows`) and sets up a new git repo.
- The `runCli` function spawns a new Node process to execute the built CLI (`dist/cli/index.mjs`). This happens for every CLI command.
- The daemon is typically started in the background (or foreground) via `runCli(['up'])`.

## Patterns in Tests (e.g., `slash-policies.test.ts`, `messages.test.ts`)
1. **Setup Boilerplate**: A test file typically calls `setupE2E()` then `runCli(['init'])`, then modifies `.clawmini/settings.json` via `fs.readFileSync` and `fs.writeFileSync` to inject test-specific configurations (like port number, policies, or specific agent commands).
2. **Daemon Spawning**: Tests interact with a running daemon out-of-process.
3. **Polling for State**: Tests heavily rely on `waitForMessage` or `vi.waitFor` to repeatedly read and parse `chat.jsonl` files from the filesystem until a specific state is reached. This is slow and prone to race conditions or timeouts.
4. **Snapshotting**: Snapshots are used, but require custom sanitation (e.g., `sanitizeContentForSnapshot`) to replace dynamic IDs (like `requestId`) with static placeholders (`<REQ_ID>`).

## Areas for Improvement
1. **Speed/Performance**:
   - Repeatedly spawning the Node process is slow. While `spawn` is authentic E2E, we might be able to provide a fast-path for some tests (integration level) or keep the daemon running across more tests.
   - Polling the filesystem adds delay (tests wait for an interval of 200-250ms).
2. **Reliability**:
   - Filesystem polling can be flaky on different OSs or under heavy load.
   - If the daemon crashes or hangs, tests might just timeout obscurely.
3. **Developer Experience / Simplicity**:
   - Mutating JSON config files inline is repetitive. A test harness could provide a `builder` or fluent API to define the workspace state upfront.
   - E2E tests are verbose. We could introduce a test abstraction, similar to a Page Object Model, e.g., `const testEnv = await setupEnv({ policies: [...] }); await testEnv.cli('messages send...'); const msg = await testEnv.waitForMessage(...);`.
   - Instead of polling log files, maybe the daemon could expose an event stream (WebSocket or SSE on the HTTP API) when in test mode, allowing tests to await actual events rather than polling the disk.
4. **Realism**:
   - Using real child processes is good for realism, but some tests set up "fake" subagents via `clawmini-lite.js` shell scripts. This is clever but might be fragile.
