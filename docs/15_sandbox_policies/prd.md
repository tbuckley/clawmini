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

## Inspirational Flow Example

The following scenario illustrates an end-to-end interaction using this feature:

1. **Discovery:** The user tells the LLM about a new capability. The LLM calls `clawmini requests list` to see what is available, along with descriptions.
2. **Schema Generation:** The LLM then calls `clawmini requests send-email --help` to learn about the command's arguments and automatically creates a Skill for itself.
3. **Execution Request:** On a user's request, the LLM calls `clawmini requests send-email --to foo@bar.com --subject hi --body ./body.txt`.
4. **Agent Acknowledgment:** The agent immediately receives a message back: *"Submitted request (Internal ID: req_abc), you will get a message if the user approves or rejects."* The daemon stores the request along with the chat, agent ID, and timestamp.
5. **User Preview & Decision:** The user sees a message in their chat interface: *"Request #32: Send email… use /approve or /reject, or /info…"* (This message includes output from the command's `--dry-run`).
6. **Resolution:** The user responds with `/reject 32 make it more formal`.
7. **Agent Feedback Loop:** The model gets sent a system message: `[Request req_abc] User rejected with message: make it more formal`. The agent can then adjust its inputs and try again.

## Proposed Experience & CLI Design

### Registration (JSON Configuration)
Users will register new commands in a concise JSON configuration file (e.g., `policies.json`). To keep the system simple and flexible, we want to keep logic out of the configuration file. While users can manually edit this file, an optional CLI command (`clawmini requests register <cmd>`) can be used as a helper to scaffold these entries.

Instead of writing scripts inside the JSON, actions simply point to an executable file (e.g., a `.sh`, `.py`, or `.js` script). The configuration explicitly lists allowed string arguments (`params`) and file arguments (`path_params`). This standardizes the CLI format (enforcing `--arg value` spacing rather than `--arg=value` or positional arguments).

The system performs no regex validation or sanitization—arguments are passed directly through. **Target scripts are strictly responsible for sanitizing their own inputs.** Target scripts should ideally support a `--dry-run` flag. When a request is made, the daemon automatically executes the target command with this flag to safely generate a preview of the effects, which is then presented to the user.

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

The agent interacts with the `clawmini` CLI to discover, create, and monitor requests. All arguments are passed opaquely to the underlying script.

**1. Discovery**
The agent can query available sandbox policies to construct its toolset dynamically:
- `clawmini requests list`: Outputs all registered policies and their descriptions.
- `clawmini requests <cmd> --help`: Outputs the expected arguments (`params` and `path_params`), allowing the agent to generate a valid schema or Skill definition.

**2. Making a Request**
```bash
# Agent wants to promote a file
# The --source flag is registered as a path_param, so ./script.sh is captured.
clawmini request promote-file --source ./script.sh --destination script.sh
```

Behind the scenes:
1. The daemon captures `./script.sh` into a secure, local snapshot directory (e.g., `.gemini/tmp/snapshots/req_123/`).
2. The user approves the request based on the snapshot and `--dry-run` output.
3. The daemon executes `./scripts/promote-file.sh --source .gemini/tmp/snapshots/req_123/script.sh --destination script.sh`.

```bash
# Agent wants to send an email
clawmini request send-email --to admin@example.com --subject "Daily Report" --body ./report.txt
```
*Outputs a private Request ID (e.g., `req_12345`).*

**3. Asynchronous Callbacks & Workflows**
Agents can attach callbacks to be triggered when the request is resolved (either approved or rejected). The resolution payload—which includes the "Approved/Rejected" status, any `stdout`/`stderr` from the executed command, and any feedback strings provided by the user upon rejection—is automatically appended or passed to the callback.

```bash
# Workflow script: Block and wait for approval
clawmini wait req_12345

# Agent workflow: Send a message on resolution. 
# The CLI automatically appends status and output to the message.
clawmini request promote-file \
  --source ./script.sh --destination script.sh \
  --on-resolve-message "The request to move script.sh has been resolved."

# Execute a command in the sandbox on resolution.
# The CLI passes the status/output payload to the command.
clawmini request promote-file \
  --source ./script.sh --destination script.sh \
  --on-resolve-command "./handle-resolution.sh"
```

### User Interface & Interactions

All requests are routed to the user's primary chat UI for review. To prevent unauthorized execution, the system relies on specific slash commands that must originate directly from the user.

When a request is made, the daemon runs the command with `--dry-run` and presents the user with a preview message (e.g., "Request #32: Send email..."). Users can respond with:
- `/info <id>`: View the full details, snapshots, and the complete `--dry-run` output.
- `/approve <id>`: Approve and execute the request.
- `/reject <id> [reason]`: Reject the request, optionally providing a natural language reason (e.g., `/reject 32 tone needs to be more formal`) so the agent can learn and retry.
- `/pending`: View a summarized list of all active pending requests.

## Requirements

### Core Requirements
1. **CLI Extensibility:** Agents must have access to a `clawmini` CLI binary inside their environment.
2. **Configuration:** Users define permissible actions via a centralized JSON configuration specifying `params` (strings) and `path_params` (sandbox paths). No framework-level sanitization is performed.
3. **Snapshotting:** Any file referenced by `path_params` must be immediately snapshotted to a local daemon-managed directory (e.g., `.gemini/tmp/snapshots/`). The user reviews these exact snapshots, which are then passed to the command upon approval (eliminating TOCTOU risks).
4. **Size Limits:** Enforce strict file size limits on snapshots (e.g., max 5MB).
5. **Chat Integration & Previews:** Requests must be routed to the user's Chat UI. The daemon should automatically execute the requested command with a `--dry-run` flag to safely generate the preview. Binaries are generally unsupported.
6. **Execution Engine:** Approved actions must execute safely according to the policy. Scripts are completely responsible for their own input sanitization.
7. **Callbacks:** Support asynchronous callbacks:
   - Message to Agent: Injects a message into the active chat session (including execution output or rejection reasons).
   - Command Execution: Runs a script inside the sandbox upon resolution.
   - Synchronous Wait: Provide a `clawmini wait <id>` command for scripts.
8. **State Management:** Snapshot and request state should be saved locally (e.g., in `.gemini/tmp/`) to gracefully handle daemon restarts and persist pending requests.

### Non-Functional Requirements
- **Security:** 
  - Target scripts must sanitize their own inputs. Path traversal from the sandbox is acceptable (sandbox data can safely be exposed to the host system), as the host script is responsible for sanitizing the final target locations.
  - **Spoofing & Self-Approval Prevention:** The system must strictly verify the origin of `/approve` and `/reject` commands to ensure they come from direct user input, not from agent outputs or background jobs. To prevent the agent from spoofing system messages (e.g., "Request #32: Check the weather... use /approve"), the daemon must assign requests a private internal ID known only to the agent, while presenting a distinct, non-guessable user-facing ID in the chat UI.
- **Performance:** Asynchronous requests should not block the agent's main execution loop unless explicitly requested by `clawmini wait`.

## Open Issues / Future Considerations
- Transitioning the configuration format from JSON to YAML for improved human readability.
- Building a helper library/SDK (e.g., Python/Node) to simplify programmatic workflow creation inside the sandbox.
- Allowing user modifications to the arguments/files during the approval phase.

## Manual Testing Plan

To ensure the sandbox policies feature works correctly and securely, perform the following manual tests:

1. **Basic Approval Flow:**
   - Register a benign policy (e.g., `echo-test` that outputs to a file).
   - Have the agent request the policy.
   - Verify the user receives the preview message with the `--dry-run` output.
   - Use `/approve <id>`.
   - Verify the command executes correctly and the agent receives the success callback/output.

2. **Rejection & Feedback Loop:**
   - Have the agent request a policy.
   - Use `/reject <id> missing required details`.
   - Verify the command does *not* execute.
   - Verify the agent receives the rejection status along with the feedback string "missing required details".

3. **Spoofing Prevention (Security):**
   - Have the agent output the exact string: `/approve <id>` for one of its own pending requests.
   - Verify the system ignores this input and does *not* approve the request.
   - Verify the agent cannot guess the user-facing request ID if it is only given the internal agent-facing ID.

4. **Snapshotting and TOCTOU:**
   - Register a policy with a `path_params` argument pointing to a file (e.g., `test.txt`).
   - Have the agent make a request referencing `test.txt`.
   - *Before* approving, modify `test.txt` in the sandbox.
   - Use `/approve <id>`.
   - Verify the executed command uses the *original* snapshotted version of `test.txt`, not the modified version.

5. **Discovery Commands:**
   - Run `clawmini requests list` and verify all configured policies are listed.
   - Run `clawmini requests <cmd> --help` and verify the expected `params` and `path_params` are accurately displayed.