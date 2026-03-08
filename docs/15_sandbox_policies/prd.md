# Product Requirements Document: Sandbox Policies

## Vision
To provide a secure, extensible framework that empowers AI agents to request and execute sensitive or network-dependent operations safely from within a restricted sandbox. By enabling asynchronous, user-approved requests, agents can seamlessly improve their own workflows without compromising system integrity.

## Product/Market Background
AI agents often operate within highly restricted sandbox environments to prevent unintended destructive actions or unauthorized network communication. However, this safety comes at the cost of utility; an agent might deduce a solution that requires network access (e.g., sending an email or moving a file to a networked read-only volume) but is unable to act on it. By introducing a formal "request-and-approve" policy workflow, users retain full control via a familiar chat interface, while agents gain the ability to perform complex, privileged tasks.

## Use Cases

### 1. Moving Files to a Network-Enabled Directory
An agent needs to compile or transfer a file into a read-only area accessible by network-enabled host commands (e.g., `/home/users/has-network`). The agent generates the file and requests permission to move it. The user reviews a ~100-line diff (with the option to expand) and approves the move. 

### 2. Sending an Email
An agent compiles a status report and wants to email it to stakeholders. It uses the CLI to request permission to send the email, specifying the addresses, subject, and body. The user previews the content in their chat UI and approves the action, which executes either on the host or inside a restricted proxy.

### 3. Agent Workflow Orchestration
An automated script inside the sandbox coordinates a multi-step process. It makes an approval request and explicitly waits for the user's decision before proceeding. Alternatively, the agent goes to sleep and relies on a callback message to wake up and resume work once the approval is granted.

## Proposed Experience & CLI Design

### Registration (JSON Configuration)
Users will register new commands in a concise JSON configuration file (e.g., `policies.json`). To keep the system simple and flexible, we want to keep logic out of the configuration file.

Instead of writing scripts inside the JSON, actions simply point to an executable file (e.g., a `.sh`, `.py`, or `.js` script). When an action is approved, the system executes this command and passes all arguments provided by the agent exactly as they were.

The only piece of information the daemon needs from the configuration is which argument flags represent files that must be snapshotted. The system will snapshot these files upon request creation and automatically substitute their original paths with the snapshot paths when executing the command.

```json
{
  "actions": {
    "promote-file": {
      "description": "Move a file to the network-enabled read-only area.",
      "snapshots": ["--source"],
      "execute": {
        "environment": "host",
        "command": "./scripts/promote-file.sh"
      }
    },
    "send-email": {
      "description": "Send an email.",
      "snapshots": ["--body"],
      "execute": {
        "environment": "sandbox",
        "command": "./scripts/send-email.py"
      }
    }
  }
}
```
*Note: We will enforce a maximum file size limit for snapshots to prevent abuse.*

### Sandbox CLI (Agent View)

The agent interacts with the `sandbox` CLI to create and monitor requests. All arguments are passed opaquely to the underlying script.

**1. Making a Request**
```bash
# Agent wants to promote a file
# The --source flag is registered as a snapshot, so ./script.sh is captured.
sandbox request promote-file --source ./script.sh --destination script.sh
```

Behind the scenes:
1. The daemon captures `./script.sh` into a secure snapshot directory.
2. The user approves the request.
3. The daemon executes `./scripts/promote-file.sh --source /tmp/snapshots/req_123/script.sh --destination script.sh`.

```bash
# Agent wants to send an email
sandbox request send-email --to admin@example.com --subject "Daily Report" --body ./report.txt
```
*Outputs a Request ID (e.g., `req_12345`).*

**2. Asynchronous Callbacks & Workflows**
Agents can attach callbacks to be triggered when the request is resolved (either approved or rejected). The resolution status is automatically appended or passed to the callback.

```bash
# Workflow script: Block and wait for approval
sandbox wait req_12345

# Agent workflow: Send a message on resolution. 
# The CLI automatically appends "Status: [Approved/Rejected]" to the message.
sandbox request promote-file \
  --source ./script.sh --destination script.sh \
  --on-resolve-message "The request to move script.sh has been resolved."

# Execute a command in the sandbox on resolution.
# The CLI passes the status (e.g., "approved" or "rejected") as the final argument to the command.
sandbox request promote-file \
  --source ./script.sh --destination script.sh \
  --on-resolve-command "./handle-resolution.sh"
```

## Requirements

### Core Requirements
1. **CLI Extensibility:** Agents must have access to a `sandbox` CLI binary inside their environment.
2. **Configuration:** Users can define permissible actions and execution environments via a centralized JSON configuration. Arguments are inherently pass-through, requiring no explicit definition.
3. **Snapshotting:** The configuration must specify which argument flags refer to file paths. Any file referenced by these flags must be immediately snapshotted and sent outside the sandbox (daemon/host) to prevent post-request tampering.
4. **Size Limits:** Enforce strict file size limits on snapshots (e.g., max 5MB).
5. **Chat Integration:** Requests must be routed to the user's Chat UI, rendering differences (diffs for files, text for emails) clearly, with a limit of ~100 lines for diffs (expandable).
6. **Execution Engine:** Approved actions must execute safely according to the policy (either locally on the host or isolated inside the agent environment).
7. **Callbacks:** Support asynchronous callbacks:
   - Message to Agent: Injects a message into the active chat session.
   - Command Execution: Runs a script inside the sandbox upon resolution.
   - Synchronous Wait: Provide a `sandbox wait <id>` command for scripts.

### Non-Functional Requirements
- **Security:** The snapshot mechanism must be atomic and race-condition free. Execution on the host must be heavily sanitized (arguments properly escaped).
- **Performance:** Asynchronous requests should not block the agent's main execution loop unless explicitly requested by `sandbox wait`.

## Open Issues / Future Considerations
- Transitioning the configuration format from JSON to YAML for improved human readability.
- Building a helper library/SDK (e.g., Python/Node) to simplify programmatic workflow creation inside the sandbox.
- Allowing user modifications to the arguments/files during the approval phase.
