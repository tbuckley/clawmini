# Policy CWD & Output File Notes

## Current Implementation

- `clawmini-lite.js` is the standalone client injected into environments. It runs inside the sandbox (e.g., Cladding, macOS).
- `clawmini-lite.js request <cmd>` is handled in `src/cli/lite.ts`, which calls `client.createPolicyRequest.mutate(...)` on the TRPC API.
- The `createPolicyRequest` procedure in `src/daemon/api/agent-router.ts` receives the command, args, and file mappings.
- The request is stored as a `PolicyRequest` (defined in `src/shared/policies.ts`).
- When a policy is approved, `src/daemon/routers/slash-policies.ts` executes the command using `executeRequest` (from `src/daemon/policy-utils.ts`), passing `getWorkspaceRoot()` as the `cwd`.
- `executeRequest` also uses `getWorkspaceRoot()` for auto-approved policies.

## Path Translation

- `src/daemon/api/router-utils.ts` has `resolveAgentDir(agentId, workspaceRoot)` which returns the host directory for an agent.
- Environments are defined in `src/shared/config.ts` (`EnvironmentSchema`).
- The prompt suggests adding a property to environments (like `baseDir`) to indicate what the environment considers its root (e.g., `/home/user`).
- If an environment specifies `baseDir: '/home/user'`, and `clawmini-lite.js` reports `cwd` as `/home/user/project/src`, the daemon can translate this by stripping `/home/user` and resolving the rest against the agent's host directory (`agentDir`).
- How does the daemon know which environment the agent is running in? The chat settings or agent settings might define the environment.

## Output File

- A new option `--output-file <path>` (or similar) will be added to `clawmini-lite.js request`.
- The prompt asks to figure out a standard way to pass the output of both stdout and stderr.
- Possibilities:
  1. Interleave stdout and stderr into one file.
  2. Output them as a JSON structure `{ "stdout": "...", "stderr": "..." }`.
  3. Support separate arguments like `--stdout-file <path>` and `--stderr-file <path>`.
  4. Write standard output to the file, and standard error to the console (or vice versa).