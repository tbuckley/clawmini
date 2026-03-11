# Sandbox Policies Guide

The Sandbox Policies feature provides a secure framework for AI agents operating within restricted sandbox environments to request and execute sensitive or network-dependent operations. Using a formal "request-and-approve" workflow, users retain full control via their chat interface while agents gain the ability to perform complex, privileged tasks like sending emails or promoting files to external systems.

## Registering a Policy

Policies are configured centrally in a JSON file located at `.clawmini/policies.json`. This configuration maps an easy-to-use policy command name to the actual script or binary you want to run when the request is approved. 

The framework treats the command execution as a "dumb pipe". It executes the specified script using a secure execution wrapper (bypassing the shell to prevent injection attacks) and interpolates safe, verified file paths.

### Example Configuration

Create or update `.clawmini/policies.json` in your workspace root:

```json
{
  "policies": {
    "send-email": {
      "description": "Sends an email using the specified body file.",
      "command": "./.clawmini/policy-scripts/send-email.sh",
      "args": ["--agent-email"],
      "allowHelp": true
    }
  }
}
```

In this example, the `send-email` policy uses a wrapper script located at `./.clawmini/policy-scripts/send-email.sh`. Any arguments defined in `args` will be prepended to the arguments the agent passes. The `allowHelp` flag must be set to `true` to enable the `--help` discovery feature for this policy.

## Agent Access via clawmini-lite

Agents running within their environment can interact with the Policies feature using the `clawmini-lite` CLI.

1. **Discovery:**
   Agents can view available policies and their descriptions:
   ```bash
   clawmini-lite requests list
   ```

2. **Help Documentation:**
   If a policy is configured with `"allowHelp": true`, agents can query it for help. This securely passes the `--help` flag to the underlying wrapper command and returns the output to the agent:
   ```bash
   clawmini-lite request send-email --help
   ```
   If `"allowHelp"` is missing or set to `false`, the agent will receive an error stating that `--help` is not supported.

3. **Submitting a Request:**
   Agents can submit a request to run a policy. The `--file` flag maps a file within the agent's sandbox to a variable name, which can be interpolated into the opaque arguments using `{{variable_name}}`. This ensures files are securely snapshotted to prevent TOCTOU (Time-of-Check to Time-of-Use) attacks.
   ```bash
   clawmini-lite request send-email --file body_txt=./report.txt -- --to admin@example.com --subject "Daily Report" --body "{{body_txt}}"
   ```
   The CLI returns a request ID immediately without blocking.

## User Interaction

When an agent creates a request, the daemon intercepts it and sends a preview message to your chat session. This message includes the command, the requested arguments, and a truncated preview of the files involved.

You can then review and interact with the pending request using the following slash commands in your chat:

- **List Pending Requests:**
  ```text
  /pending
  ```
  *Lists all active pending requests that need review.*

- **Approve a Request:**
  ```text
  /approve <request_id>
  ```
  *Approves the request. The configured script executes securely, and the STDOUT/STDERR results are automatically sent back to the agent in the chat.*

- **Reject a Request:**
  ```text
  /reject <request_id> [reason]
  ```
  *Rejects the request. You can provide an optional natural language reason (e.g., `/reject 123 Tone needs to be more formal`) to help the agent correct its output and try again.*
