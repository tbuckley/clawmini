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

### Inspecting a Single Policy

To see the full definition of a policy (its underlying command, args, and flags like `autoApprove` / `allowHelp`):

```bash
clawmini-lite.js requests show <policy-name>
```

The output is JSON, followed by the script body when the policy's command points at a file inside `.clawmini/policy-scripts/`. Policies that wrap a system command print only the JSON — there is no script body to show, and the daemon refuses to read paths outside `policy-scripts/`. Reading is unrestricted — no approval is needed.

If the script body is large, it is copied to `./tmp/policy-script-<name><ext>` instead of being printed inline; `requests show` will tell you the path so you can `cat` or `Read` it on demand.

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

When you submit a request, the CLI usually returns a **Request ID** without blocking. **The request has not run yet** — it is queued for the user to review, and the underlying command will only execute once the user approves it.

When the user approves (or rejects) the request, the result will arrive as a **new user message in this chat**. **Do not poll** — do not run `requests show`, re-invoke the request, or otherwise loop checking for status. Finish any unrelated work that does not depend on this request, then end your turn with a brief message explaining you are blocked on this request.

- **If Approved:** The policy executes securely, and the STDOUT/STDERR results will be automatically sent back to you in the chat.
- **If Rejected:** The user may provide a reason for the rejection, allowing you to correct your request and try again.

## Managing Policies

The built-in `manage-policies` policy lets you add, update, or remove policies. Each invocation goes through the same approval workflow as any other policy — the user reviews exactly which subcommand and arguments you proposed before anything mutates `policies.json`. Reads do not go through this script; use `requests show <name>` (above) for read access.

The script has three subcommands: `add`, `update`, `remove`.

**Important Note for Large Outputs:** If a policy or command produces massive output (like raw API JSON responses), it will overwhelm your context window. In these cases, it is strongly recommended to register a custom policy script that uses tools like `jq` to parse, filter, and condense the data _before_ it is returned to you.

### Adding a New Policy (`add`)

Provide a `--name` and `--description`, and either a shell `--command` or a `--script-file`. The script refuses to overwrite an existing entry — use `update` (below) if the name already exists.

By default a new policy is **safe**: every invocation requires the user to approve it, and `--help` requests are blocked. You can opt in to looser behavior with two flags — both are prefixed `--dangerously-` because the user only sees them at proposal time:

- `--dangerously-auto-approve`: future invocations of this policy run without the user reviewing each request. Only use for fully sandboxed, side-effect-free commands (e.g. read-only listings of local files). Never use for anything that mutates state, talks to the network, or spends money.
- `--dangerously-allow-help`: lets you (the agent) run `<policy> --help` without approval. Safe only if the underlying command actually treats `--help` as read-only — many CLIs do, but custom scripts may not.

If neither flag is set, both default to `false`. Prefer the safe default; only request the dangerous flags when you can justify them in the policy description.

**Examples:**

1. **A simple command wrapper (safe defaults):**

   ```bash
   clawmini-lite.js request manage-policies -- add --name npm-install --description "Run npm install globally" --command "npm install -g"
   ```

2. **A custom script wrapper:**
   First, write your complex logic to a file (e.g., `./script.sh`). **Note: The script file path MUST be inside your allowed workspace directory or use relative paths.**

   ```bash
   clawmini-lite.js request manage-policies --file script=./script.sh -- add --name custom-action --description "Run a custom deployment script" --script-file "{{script}}"
   ```

3. **A read-only policy that auto-approves and exposes `--help`:**

   ```bash
   clawmini-lite.js request manage-policies -- add --name list-files --description "List files in the workspace (read-only)" --command "ls" --dangerously-auto-approve --dangerously-allow-help
   ```

### Updating an Existing Policy (`update`)

Pass only the fields you want to change. The policy's name cannot be changed (`remove` + `add` if you need a rename).

```bash
clawmini-lite.js request manage-policies -- update --name <policy-name> [--description "..."] [--command "..."] [--script-file "{{script}}"] [--dangerously-auto-approve | --no-dangerously-auto-approve] [--dangerously-allow-help | --no-dangerously-allow-help]
```

The dangerous flags use the same bare-flag style as `add`: pass `--dangerously-auto-approve` to enable, `--no-dangerously-auto-approve` to disable, or omit it to leave the field unchanged.

This refuses to update a built-in policy. If you need to override a built-in, register your own version with `add` first; subsequent updates target that override.

If the policy is currently disabled (a `false` entry from `remove --disable-builtin`), `update` will tell you to clear the disable first via `remove --name <policy-name>` (without `--disable-builtin`), then re-register with `add`.

### Removing a Policy (`remove`)

Drops a registered policy entry:

```bash
clawmini-lite.js request manage-policies -- remove --name <policy-name>
```

To opt out of a built-in (write `false` so it stops being available even if its script is installed):

```bash
clawmini-lite.js request manage-policies -- remove --name <builtin-name> --disable-builtin
```

## Creating New Skills for Policies

When you discover or use a new policy frequently, you should create a dedicated Agent Skill for it. This guides developers and future agents on how to use the policy without needing to manually look up the `--help` each time.

To create a new skill for a policy, activate the skill-creator skill. Ensure that your SKILL.md documents the purpose of the policy, its required arguments, and provides clear examples of how to format the `clawmini-lite.js request` command.

This ensures you have a permanent, easily accessible reference for executing that specific privileged operation.
