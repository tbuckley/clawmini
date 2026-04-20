---
name: run-host
description: Use this to execute an arbitrary shell command outside your sandbox. The command runs on the host through `sh -c`.
---

# Run Host

`run-host` is a default policy that lets you execute an arbitrary shell command on the host system. It is intentionally generic — use it when no more specific policy fits the task.

Because it can do anything the host shell can do, the user will be asked to approve every invocation.

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

## When to Prefer a Dedicated Policy

If you find yourself repeatedly requesting `run-host` for the same task, propose a dedicated policy with `propose-policy` instead. Dedicated policies are easier to review, can be auto-approved when safe, and give you a clearer skill to call.
