---
name: run-host
description: Last-resort escape hatch for running arbitrary shell commands on the host. Prefer proposing a dedicated policy first.
---

# Run Host

**Before using this, propose a dedicated policy.** `run-host` is a generic escape hatch that forwards a command string to `sh -c`. It exists so you are never fully blocked, but it is the wrong tool for anything you will do more than once.

For any task you can describe — running tests, installing a package, calling a specific API — use `propose-policy` to register a named policy instead. Dedicated policies are easier for the user to review, can be auto-approved when safe, and give you a clear skill to call next time. Reach for `run-host` only when:

- You need a genuinely one-off exploratory command (e.g. inspecting an unfamiliar file), **or**
- You truly cannot express the task as a reusable policy.

Because it can do anything the host shell can do, the user will be asked to approve every invocation, and repeated `run-host` requests for similar tasks are a signal that you should have proposed a policy.

## Usage

Pass the command to run as a single string via `--command`. The string is forwarded to `sh -c`, so you can use pipes, redirection, and chained operators.

```bash
clawmini-lite.js request run-host -- --command "<your shell command>"
```

### Examples

1. **Simple command:**

   ```bash
   clawmini-lite.js request run-host -- --command "ls -la"
   ```

2. **Pipes and redirection:**

   ```bash
   clawmini-lite.js request run-host -- --command "cat file.txt | grep error > errors.log"
   ```

3. **Chained commands:**

   ```bash
   clawmini-lite.js request run-host -- --command "npm install && npm test"
   ```

### Getting Help

The policy supports `--help`, which prints argument documentation:

```bash
clawmini-lite.js request run-host --help
```
