# Questions

1. **Test Environment API:** Do you agree that we should build a more robust `TestEnvironment` or `TestFixture` class/helper to encapsulate the boilerplate of setting up the `.clawmini` workspace (creating directories, editing `settings.json`, adding policies/agents) and managing the CLI/daemon lifecycle?
   * **Answer:** Yes, this direction seems good.
2. **Polling vs. Events:** Currently, we poll `.jsonl` files on disk. This is a bit slow and flaky. Would you prefer we keep polling (but maybe optimize the helper functions) or should we add a test-only event stream (like an SSE endpoint or a local IPC socket) to the daemon to push events to the test runner?
   * **Answer:** Use the existing SSE endpoint that the daemon exposes for adapters. It would be faster and more realistic.
3. **Daemon Lifecycle:** In many tests, we start and stop the daemon per test or per suite. It takes time. Are you open to running a shared daemon where possible, or do you prefer the strict isolation of a fresh daemon + fresh directory for every test suite (the current approach)?
   * **Answer:** Yes, running one daemon would be a big win.
4. **Subagents Mocking:** We use `clawmini-lite.js` inside shell commands to mock subagents. Is this approach considered realistic enough, or do we want to provide actual mocked subagent binaries/scripts as part of the test harness?
   * **Answer:** The verbosity should be reduced by using the built-in feature where an environment exports `clawmini-lite.js` and adds it to the `$PATH` for the agent.
5. **JSON/Filesystem Mutation Abstraction:** I noticed across `cron.test.ts`, `environments.test.ts`, and others, there's significant use of `fs.readFileSync` and `fs.writeFileSync` to write simple JSON configs or scripts. This confirms the need for an abstracted setup layer. Should this test harness layer expose high-level domain operations like `env.addAgent({ ... })` or low-level generic file editors like `env.writeJson('path', payload)`?
   * **Answer:** Ideally expose high-level domain operations that use the CLI wherever possible, and fall back on file editing only where necessary.
