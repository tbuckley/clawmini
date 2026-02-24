# Notes on Tool Usage

## Avoid Heredocs (`cat << EOF`) in `run_shell_command`
- **Issue**: Running commands like `cat << 'EOF' > file.ts ... EOF` via `run_shell_command` often fails with `bash: -c: line X: syntax error: unexpected end of file`.
- **Reason**: The API executes commands as `bash -c <command>`. Sending multiline strings with heredoc markers through the JSON payload, Node.js process execution, and the `bash -c` wrapper frequently causes whitespace/newline truncation or escaping issues, making bash miss the `EOF` token.
- **Solution**: Always use the native `write_file` tool to create or write content to files. It handles string formatting, special characters, and newlines safely without relying on shell escaping.

# Architectural Learnings & Notes

## Native Web APIs in Node (Node 18+)
- **Issue:** Using `undici` or external polyfills for standard `fetch`, `Response`, and `Headers` can be cumbersome or break depending on CJS/ESM module resolution. 
- **Solution:** Rely exclusively on global Web APIs (`globalThis.Request`, `globalThis.Response`, `globalThis.Headers`) built directly into Node 18+. To bridge `http.request` outputs, you can instantiate a new native `Response(body, { status, headers })` safely without third-party fetch abstractions.

## Custom Fetch implementations for tRPC over UNIX Sockets
- **Insight:** tRPC client adapters (like `@trpc/client/links/httpLink`) require a `fetch`-like signature but enforce strict TypeScript requirements.
- **Typing Fix:** If you build a custom `fetch` wrapper using `node:http` to route requests explicitly through UNIX socket paths (`socketPath`), defining the signature as `(input: string | URL | globalThis.Request, init?: unknown): Promise<globalThis.Response>` perfectly threads the needle between tRPC's internal `FetchEsque` requirements and strict TypeScript compilation without falling back to `any`.
- **`httpLink` URL**: The adapter still strictly requires a valid `url` property (e.g. `http://localhost`) even if you override the `fetch` interceptor to ignore it and point to a UNIX socket.

## Robust E2E Testing for CLI & Daemon
- **Spawning strategy**: Testing `commander` CLI instances that spin up background daemon processes requires fully isolated E2E tests, separate from unit tests. Use `node:child_process.spawn` pointing to the pre-compiled `dist/cli/index.mjs` entry point.
- **Directory Isolation**: Always run E2E CLI commands in an isolated sandbox temporary directory (`cwd: e2eDir`) rather than the workspace root. This ensures configuration file generation `.clawmini/settings.json`, daemon log dumps, and UNIX socket files do not pollute the developer workspace or accidentally load development artifacts.
- **Teardown**: Background daemon processes (`detached: true`) spawned by CLI tests *will persist* past test completion. Explicitly run a cleanup command (e.g., `pkill -f "dist/daemon/index.mjs"`) in the testing framework's `afterAll` hook to prevent zombie processes.