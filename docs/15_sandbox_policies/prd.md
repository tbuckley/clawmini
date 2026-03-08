# Product Requirements Document: Sandbox Policies

## Vision
To provide a secure, extensible framework that empowers AI agents to request and execute sensitive or network-dependent operations safely from within a restricted sandbox. By enabling asynchronous, user-approved requests, agents can seamlessly improve their own workflows without compromising system integrity.

## Product/Market Background
AI agents often operate within highly restricted sandbox environments to prevent unintended destructive actions or unauthorized network communication. However, this safety comes at the cost of utility; an agent might deduce a solution that requires network access (e.g., sending an email or moving a file to a networked read-only volume) but is unable to act on it. By introducing a formal "request-and-approve" policy workflow, users retain full control via a familiar chat interface, while agents gain the ability to perform complex, privileged tasks.

## Use Cases

### 1. Moving Files to a Network-Enabled Directory
An agent needs to compile or transfer a file into a read-only area accessible by network-enabled host commands (e.g., `/home/users/has-network`). The agent generates the file and requests permission to move it. The user reviews a custom preview defined by the policy (e.g., a file diff, the full file content, or automated bot evaluation) and approves the move. (Note: Binaries are generally not supported for these workflows).

### 2. Sending an Email
An agent compiles a status report and wants to email it to stakeholders. It uses the CLI to request permission to send the email, specifying the addresses, subject, and body. The user previews the content in their chat UI and approves the action, which executes either on the host or inside a restricted proxy.

### 3. Agent Workflow Orchestration
An automated script inside the sandbox coordinates a multi-step process. It makes an approval request and explicitly waits for the user's decision before proceeding. Alternatively, the agent goes to sleep and relies on a callback message to wake up and resume work once the approval is granted.

## Proposed Experience & CLI Design

### Registration (JSON Configuration)
Users will register new commands in a concise JSON configuration file (e.g., `policies.json`). To keep the system simple and flexible, we want to keep logic out of the configuration file.

Instead of writing scripts inside the JSON, actions simply point to an executable file (e.g., a `.sh`, `.py`, or `.js` script). The configuration explicitly lists allowed string arguments (`params`) and file arguments (`path_params`). This standardizes the CLI format (enforcing `--arg value` spacing rather than `--arg=value` or positional arguments).

The system performs no regex validation or sanitization—arguments are passed directly through. **Target scripts are strictly responsible for sanitizing their own inputs.**

When a request is made, the system snapshots any files referenced by `path_params`. The user reviews these exact snapshots, eliminating TOCTOU (Time-of-Check to Time-of-Use) risks. Upon approval, the system executes the command, substituting the original sandbox paths with the local snapshot paths.

```json
{
  "actions": {
    "promote-file": {
      "description": "Move a file to the network-enabled read-only area.",
      "params": ["--destination"],
      "path_params": ["--source"],
      "execute": {
        "environment": "host",
        "command": "./scripts/promote-file.sh"
      }
    },
    "send-email": {
      "description": "Send an email.",
      "params": ["--to", "--subject"],
      "path_params": ["--body"],
      "execute": {
        "environment": "sandbox",
        "command": "./scripts/send-email.py"
      }
    }
  }
}
```
*Note: We will enforce a maximum file size limit for snapshots to prevent abuse.*

### Clawmini CLI (Agent View)

The agent interacts with the `clawmini` CLI to create and monitor requests. All arguments are passed opaquely to the underlying script.

**1. Making a Request**
```bash
# Agent wants to promote a file
# The --source flag is registered as a path_param, so ./script.sh is captured.
clawmini request promote-file --source ./script.sh --destination script.sh
```

Behind the scenes:
1. The daemon captures `./script.sh` into a secure, local snapshot directory (e.g., `.gemini/tmp/snapshots/req_123/`).
2. The user approves the request based on the snapshot.
3. The daemon executes `./scripts/promote-file.sh --source .gemini/tmp/snapshots/req_123/script.sh --destination script.sh`.

```bash
# Agent wants to send an email
clawmini request send-email --to admin@example.com --subject "Daily Report" --body ./report.txt
```
*Outputs a Request ID (e.g., `req_12345`).*

**2. Asynchronous Callbacks & Workflows**
Agents can attach callbacks to be triggered when the request is resolved (either approved or rejected). The resolution status is automatically appended or passed to the callback.

```bash
# Workflow script: Block and wait for approval
clawmini wait req_12345

# Agent workflow: Send a message on resolution. 
# The CLI automatically appends "Status: [Approved/Rejected]" to the message.
clawmini request promote-file \
  --source ./script.sh --destination script.sh \
  --on-resolve-message "The request to move script.sh has been resolved."

# Execute a command in the sandbox on resolution.
# The CLI passes the status (e.g., "approved" or "rejected") as the final argument to the command.
clawmini request promote-file \
  --source ./script.sh --destination script.sh \
  --on-resolve-command "./handle-resolution.sh"
```

## Requirements

### Core Requirements
1. **CLI Extensibility:** Agents must have access to a `clawmini` CLI binary inside their environment.
2. **Configuration:** Users define permissible actions via a centralized JSON configuration specifying `params` (strings) and `path_params` (sandbox paths). No framework-level sanitization is performed.
3. **Snapshotting:** Any file referenced by `path_params` must be immediately snapshotted to a local daemon-managed directory (e.g., `.gemini/tmp/snapshots/`). The user reviews these exact snapshots, which are then passed to the command upon approval (eliminating TOCTOU risks).
4. **Size Limits:** Enforce strict file size limits on snapshots (e.g., max 5MB).
5. **Chat Integration & Previews:** Requests must be routed to the user's Chat UI. Previews should be customizable by the script/action (e.g., a file diff, full text, or evaluation by bots). Binaries are generally unsupported.
6. **Execution Engine:** Approved actions must execute safely according to the policy. Scripts are completely responsible for their own input sanitization.
7. **Callbacks:** Support asynchronous callbacks:
   - Message to Agent: Injects a message into the active chat session.
   - Command Execution: Runs a script inside the sandbox upon resolution.
   - Synchronous Wait: Provide a `clawmini wait <id>` command for scripts.
8. **State Management:** Snapshot and request state should be saved locally (e.g., in `.gemini/tmp/`) to gracefully handle daemon restarts and persist pending requests.

### Non-Functional Requirements
- **Security:** Target scripts must sanitize their own inputs. Path traversal from the sandbox is acceptable (sandbox data can safely be exposed to the host system), as the host script is responsible for sanitizing the final target locations.
- **Performance:** Asynchronous requests should not block the agent's main execution loop unless explicitly requested by `clawmini wait`.

## Open Issues / Future Considerations
- Transitioning the configuration format from JSON to YAML for improved human readability.
- Building a helper library/SDK (e.g., Python/Node) to simplify programmatic workflow creation inside the sandbox.
- Allowing user modifications to the arguments/files during the approval phase.