---
name: clawmini-requests
description: You are in a sandbox. Use this skill to submit requests to execute sensitive or network-dependent operations, and to discover available policies.
---

# Clawmini Requests

You are running within a restricted sandbox environment. To perform complex, privileged tasks (like sending emails or interacting with external systems), you must use the "request-and-approve" workflow via the `clawmini-lite.js` CLI (available on your PATH).

This system allows you to submit a request to execute a specific policy. The user will review your request and can approve or reject it.

## Discovery and Help

### Listing Available Policies

To see which policies are available for you to request:

```bash
clawmini-lite.js requests list
```

This will output the available policy names and their descriptions.

### Getting Help for a Policy

If a policy supports it, you can query it for help to understand what arguments it expects:

```bash
clawmini-lite.js request <policy-name> --help
```

_(Note: If the policy does not support help, you will receive an error.)_

## Submitting a Request

To submit a request to execute a policy, use the following syntax:

```bash
clawmini-lite.js request <policy-name> [options] -- [policy-arguments]
```

### Passing Files Securely

When you need to pass file contents to a policy, you **must** use the `--file` flag to securely map a file in your sandbox to a variable. This prevents security issues and ensures the exact file state is captured.

```bash
clawmini-lite.js request <policy-name> --file <variable_name>=<path/to/file> -- --argument "{{variable_name}}"
```

**Example:**

```bash
clawmini-lite.js request send-email --file body_txt=./report.txt -- --to admin@example.com --subject "Daily Report" --body "{{body_txt}}"
```

### What Happens Next

When you submit a request, the CLI immediately returns a **Request ID** without blocking.
The request is sent to the user's chat interface for review.

- **If Approved:** The policy executes securely, and the STDOUT/STDERR results will be automatically sent back to you in the chat.
- **If Rejected:** The user may provide a reason for the rejection, allowing you to correct your request and try again.

## Proposing New Policies

If you need to perform an action that isn't covered by an existing policy, you can propose a new one using the default `propose-policy` policy. This allows you to request the creation of a new permission wrapper.

**Important Note for Large Outputs:** If a policy or command produces massive output (like raw API JSON responses), it will overwhelm your context window. In these cases, it is strongly recommended to propose a custom policy script that uses tools like `jq` to parse, filter, and condense the data *before* it is returned to you.

You must provide a `--name` and `--description`, and either a shell `--command` or a `--script-file`.

**Examples:**

1. **Propose a simple command wrapper:**

   ```bash
   clawmini-lite.js request propose-policy -- --name npm-install --description "Run npm install globally" --command "npm install -g"
   ```

2. **Propose a custom script wrapper:**
   First, write your complex logic to a file (e.g., `./script.sh`). **Note: The script file path MUST be inside your allowed workspace directory or use relative paths.**
   ```bash
   clawmini-lite.js request propose-policy --file script=./script.sh -- --name custom-action --description "Run a custom deployment script" --script-file "{{script}}"
   ```

## Creating New Skills for Policies

When you discover or use a new policy frequently, you should create a dedicated Agent Skill for it. This guides developers and future agents on how to use the policy without needing to manually look up the `--help` each time.

To create a new skill for a policy, activate the skill-creator skill. Ensure that your SKILL.md documents the purpose of the policy, its required arguments, and provides clear examples of how to format the `clawmini-lite.js request` command.

This ensures you have a permanent, easily accessible reference for executing that specific privileged operation.
