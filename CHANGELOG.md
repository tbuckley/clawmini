# clawmini

## 0.0.10

### Patch Changes

- [#213](https://github.com/tbuckley/clawmini/pull/213) [`69f1bcc`](https://github.com/tbuckley/clawmini/commit/69f1bcc82af849898032d1d89421ff77252ad3ab) Thanks [@tbuckley](https://github.com/tbuckley)! - Improve turn log for discord and policy approvals

- [#218](https://github.com/tbuckley/clawmini/pull/218) [`16ac827`](https://github.com/tbuckley/clawmini/commit/16ac82736f22a5b9853dcde611bdad30900ad99e) Thanks [@tbuckley](https://github.com/tbuckley)! - Add `clawmini-lite history` and the underlying `getThreadHistory` agent endpoint, so an agent can read prior turns of the user-visible chat — even ones written by an earlier agent session it did not author. The endpoint returns user/agent messages oldest-first with `--before` cursor pagination, filters out tool/command/policy/subagent traffic and `displayRole: 'agent'` auto-replies, and rejects subagent tokens. The gemini-claw template now points the agent at this command in its `# Messaging` guidance.

## 0.0.7

### Patch Changes

- [#212](https://github.com/tbuckley/clawmini/pull/212) [`0017867`](https://github.com/tbuckley/clawmini/commit/0017867bf2a63c0a5f29b0a9c3d1025a77dfff47) Thanks [@tbuckley](https://github.com/tbuckley)! - Fix `run-with-network` policy in the `cladding` environment template so it
  accepts shell features. The policy used to invoke
  `cladding run-with-scissors <args>` directly, which execs argv inside the
  sandbox — so commands with env-var prefixes (`FOO=1 echo $FOO`),
  multi-statement commands (`echo a && echo b`), pipes, or redirection failed.

  The policy now points at a new `run-with-network.mjs` script that takes
  `--command "<shell command>"` (matching the `run-host` interface) and wraps
  the string in `cladding run-with-scissors sh -c …` so the full shell grammar
  is available. The global `run-host` policy already wraps commands in
  `sh -c` and supports these cases.

- [#214](https://github.com/tbuckley/clawmini/pull/214) [`08dde92`](https://github.com/tbuckley/clawmini/commit/08dde92ea78fb0fccd75f31a6f2a1373a18219e4) Thanks [@tbuckley](https://github.com/tbuckley)! - Fix changeset releases

- [#209](https://github.com/tbuckley/clawmini/pull/209) [`aaea4d9`](https://github.com/tbuckley/clawmini/commit/aaea4d9e0f6e9c21d3d8f64748849b959f5bff5c) Thanks [@tbuckley](https://github.com/tbuckley)! - Fix release workflow: install Playwright browsers before running
  validate so the web tests pass on CI, bump Node to 24, and switch npm
  publishing to Trusted Publishing via OIDC instead of an `NPM_TOKEN`.

- [#208](https://github.com/tbuckley/clawmini/pull/208) [`007a8d1`](https://github.com/tbuckley/clawmini/commit/007a8d1289ba91b4973c80b390ad77a3e1103cc0) Thanks [@tbuckley](https://github.com/tbuckley)! - Track skills for every agent, not just `extends`. Forks and hand-written
  agents now install and refresh skills via the same SHA-tracked manifest
  pipeline, so `up` and `up --dry-run` surface skill plan actions for them
  and clawmini upgrades push skill updates universally. `skillsDir: null`
  remains the explicit opt-out.

- [#211](https://github.com/tbuckley/clawmini/pull/211) [`bfe6e40`](https://github.com/tbuckley/clawmini/commit/bfe6e403eb94bb9cd9a2719538f66f505c6cf4bb) Thanks [@tbuckley](https://github.com/tbuckley)! - Guide the agent to wait on queued policy requests instead of polling. The
  `clawmini-requests` skill and the `request <policy>` CLI output now make
  clear that a returned Request ID means the command has not yet run, the
  result will arrive as a new user message after approval, and the agent
  should finish unrelated work and end its turn rather than loop checking
  status.
