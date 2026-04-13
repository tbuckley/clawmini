# Product Requirements Document (PRD): Policy Execution Context and Output Handling

## Vision

To enhance the reliability and usability of policy requests within Clawmini's sandboxed environments. This is achieved by ensuring policies execute in the correct working directory relative to the agent's sandbox, and by improving how large policy execution outputs (stdout/stderr) are returned to the agent, preventing truncation issues and keeping the chat history clean.

## Product / Market Background

Currently, when a sandboxed agent uses `clawmini-lite.js request <policy>`, the daemon executes the policy in the root directory of the workspace, regardless of where the agent invoked the command inside its sandbox. This causes friction, as agents often expect commands to run in their current working directory (`cwd`) and must resort to passing absolute paths as arguments.

Furthermore, if a policy generates a large amount of output, including it directly in the JSON response or chat message can overwhelm the context window or result in truncated logs. A robust mechanism to handle varying sizes of standard output and standard error is necessary.

## Use Cases

1. **Context-Aware Policy Execution:** An agent running in a macOS proxy environment navigates to `~/project/src` inside its sandbox and issues a policy request. The host daemon translates `~/project/src` to the corresponding host directory (e.g., `/Users/tbuckley/projects/agent-1/project/src`) and executes the policy command there.
2. **Handling Large Output Logs:** A policy request performs a large build task that outputs 5000 characters to `stdout`. Instead of returning the massive text directly in the message, the daemon saves the output to a temporary file (e.g., `./tmp/stdout-<id>.txt` within the agent's directory) and responds with a summary: "stdout is 5000 characters, saved to ./tmp/stdout-<id>.txt".

## Requirements

### 1. Environment `baseDir` Configuration

- The `EnvironmentSchema` (in `src/shared/config.ts`) must be updated to include an optional `baseDir` string property.
- `baseDir` represents the root path _inside_ the sandbox that maps to the agent's root directory on the host.
- If `baseDir` is undefined, the system assumes the sandbox shares the host filesystem (no path translation required).

### 2. Path Translation for Policy Execution

- `clawmini-lite.js` (specifically `src/cli/lite.ts`) must capture its current working directory (`process.cwd()`) and send it as part of the `createPolicyRequest` mutation.
- The `PolicyRequest` type must be updated to include an optional `cwd` property.
- When the daemon executes an approved policy (both manual and auto-approved), it must translate the requested `cwd` from the sandbox perspective to an absolute path on the host.
- **Translation Logic:** If the environment has a `baseDir` defined (e.g., `/home/user`), and the requested `cwd` starts with that `baseDir` (e.g., `/home/user/foo`), the daemon strips the `baseDir` and resolves the remainder (`/foo`) against the agent's root directory on the host (`agentDir`).
- The translated path must be validated to ensure it does not break out of the agent's allowed workspace directory. If it attempts to escape the directory, execution should fail safely.
- The policy must be executed with the translated directory as its `cwd` instead of `getWorkspaceRoot()`.

### 3. Smart Output Handling

- The response mechanism for policy execution (both the CLI output from `clawmini-lite.js` and the chat messages sent back to the agent) must dynamically handle `stdout` and `stderr`.
- For `stdout` and `stderr` independently:
  - If the output length is **less than 500 characters**, include it directly in the message payload as text.
  - If the output length is **greater than or equal to 500 characters**, the daemon must:
    1. Create a file inside the agent's local `./tmp/` directory (e.g., `./tmp/stdout-<id>.txt` or `./tmp/stderr-<id>.txt`).
    2. Write the full output to this file.
    3. Include a reference string in the message payload instead of the raw text, formatted as: `stdout is <length> characters, saved to ./tmp/stdout-<id>.txt`. (Substitute `stderr` as appropriate).

### 4. Updates to `clawmini-lite.js` Output

- `clawmini-lite.js request` must output the results to the terminal so the agent can read them.
- If the output was saved to a file, the CLI must print the reference string (e.g., "stdout is 1234 characters, saved to ./tmp/stdout-foo.txt") so the agent knows where to find the data.
- The `executeRequest` result must return the structured info needed to determine if the output was inline or saved to a file.

## Technical Details & Architecture Notes

- Modifying `createPolicyRequest` in `src/daemon/api/agent-router.ts` to accept `cwd`.
- The `Environment` definition will be accessed via the active chat settings or agent definition to resolve `baseDir`.
- Update `src/daemon/routers/slash-policies.ts` and auto-approve logic to invoke the path translation helper.
- Update `executeSafe` or the caller in `executeRequest` to write to `./tmp/` and construct the modified response payload.

## Privacy, Security, and Accessibility Concerns

- **Security (Path Traversal):** The path translation mechanism must rigorously ensure the final translated host path is strictly within the agent's assigned directory on the host (`pathIsInsideDir`). A malicious agent could manipulate the sandbox `cwd` to escape the directory if `baseDir` replacement isn't carefully validated.
- **Security (File Permissions):** Temporary output files written to `./tmp/` must be readable by the agent running within the sandbox.
- **Resource Limits:** Large outputs saved to `./tmp/` should be reasonably sized. While file limits aren't explicitly requested here, writing massive outputs should be monitored to prevent disk exhaustion.

## Testing & Validation

We will use explicit End-to-End (E2E) tests leveraging the `debug` agent template (which echoes executed commands and their output) to validate this behavior:

1. **Context-Aware `cwd` Test:**
   - Define a policy that runs `pwd` and has autoApprove:true.
   - Start an agent using the `debug` template.
   - Using `clawmini-lite.js` within a sub-directory of the agent (e.g., `cd foo && clawmini-lite.js request pwd`), request the `pwd` policy.
   - Validate that the policy prints the correct mapped subdirectory path (i.e. resolving to `foo` inside the agent's host directory, not the workspace root).
2. **Smart Output Length Tests:**
   - Define a policy that generates short output (< 500 chars) and one that generates long output (>= 500 chars), both with autoApprove:true.
   - For the short output policy, validate that the output is included directly inline within the response.
   - For the long output policy, validate that the direct output text is suppressed and instead the response contains the correctly formatted reference string: `stdout is <length> characters, saved to ./tmp/stdout-<id>.txt`. Ensure the file is created in the expected location.
   - Ensure the agent can run `more ./tmp/stdout-<id>.txt` to read the contents.
