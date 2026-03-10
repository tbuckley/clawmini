# Product Requirements Document: Sandbox Policies

## Vision
To provide a secure, extensible framework that empowers AI agents to request and execute sensitive or network-dependent operations safely from within a restricted sandbox. By enabling asynchronous, user-approved requests, agents can seamlessly integrate privileged tasks into their workflows without compromising system integrity.

## Product/Market Background
AI agents often operate within highly restricted sandbox environments to prevent unintended destructive actions or unauthorized network communication. However, this safety comes at the cost of utility; an agent might deduce a solution that requires network access (e.g., sending an email or moving a file to a networked read-only volume) but is unable to act on it. By introducing a formal "request-and-approve" policy workflow, users retain full control via a familiar chat interface, while agents gain the ability to perform complex, privileged tasks.

## Use Cases

### 1. Moving Files to a Network-Enabled Directory
An agent needs to compile or transfer a file into a read-only area accessible by network-enabled host commands (e.g., `/home/users/has-network`). The agent generates the file and requests permission to move it. The user reviews the request and approves the move. (Note: Binaries are generally not supported for these workflows).

### 2. Sending an Email
An agent compiles a status report and wants to email it to stakeholders. It uses the CLI to request permission to send the email, explicitly passing the file payload. The user previews the requested action in their chat UI and approves the action, which executes safely.

### 3. Agent Workflow Orchestration
An automated script inside the sandbox coordinates a multi-step process. It makes an approval request via the CLI, which returns immediately. The agent relies on an automatically injected chat message from the daemon to know when the request is approved or rejected before proceeding with the next steps in its conversation.

## Inspirational Flow Example

The following scenario illustrates an end-to-end interaction using this feature:

1. **Discovery:** The user tells the LLM about a new capability. The LLM calls `clawmini requests list` to see what is available, along with descriptions.
2. **Schema Generation:** The LLM then calls `clawmini request send-email --help` to execute the underlying command with `--help` and read its output to learn about the expected arguments.
3. **Execution Request:** On a user's request, the LLM initiates the action. It explicitly tags a file for snapshotting and passes the rest of the arguments opaquely:
   `clawmini request send-email --file body_txt=./body.txt -- --to foo@bar.com --subject hi --body "{{body_txt}}"`
4. **Agent Acknowledgment:** The CLI command returns immediately, outputting: *"Submitted request (ID: 32). You will get a message in the chat if the user approves or rejects."* The daemon stores the request on disk to survive restarts.
5. **User Preview & Decision:** The user sees a message in their chat interface: *"Request #32: Agent wants to run `send-email` with args: `--to foo@bar.com --subject hi --body /tmp/snapshot/.../body.txt`... use `/approve 32` or `/reject 32`..."* The preview also includes the contents of the file, abbreviated to ~500 characters (or up to ~2000 characters total across multiple files), providing the user with immediate context for what is being sent.
6. **Resolution:** The user responds with `/reject 32 make it more formal`. (The system verifies this command originated from the user, not the agent).
7. **Agent Feedback Loop:** The daemon automatically injects a message into the active chat session: `[Request 32] User rejected with message: make it more formal`. The agent can then adjust its inputs and try again.

## Proposed Experience & CLI Design

### Registration (JSON Configuration)
Users will register new commands in a concise JSON configuration file (e.g., `policies.json`). The framework adopts a **"Dumb Pipes, Smart Endpoints"** philosophy. The configuration avoids complex argument parsing. Instead, it merely provides a description and points to an executable wrapper script. If users want to restrict the flags an agent can use, they enforce those restrictions within their wrapper script. When the agent requests help for a command, the framework executes the wrapper script with `--help` and returns the output to the agent.

```json
{
  "actions": {
    "promote-file": {
      "description": "Move a file to the network-enabled read-only area.",
      "execute": {
        "environment": "host",
        "command": "./scripts/promote-file.sh"
      }
    },
    "send-email": {
      "description": "Send an email.",
      "execute": {
        "environment": "sandbox",
        "command": "./scripts/send-email-wrapper.py"
      }
    }
  }
}
```

### Security & Sanitization Strategy

To ensure robust security against command injection, path traversal, and race conditions, the system employs the following mechanisms:

1. **Direct Exec Arrays (No Shell Injection):** The system completely bypasses shell string concatenation. The daemon executes commands directly via an OS-level exec array (e.g., `spawn('script.sh', ['--to', 'admin@foo.com'])`). This treats all arguments as pure literal data, making classic shell injection (like passing `&& rm -rf /`) impossible.
2. **Explicit Named Variable Map for Files:** The daemon does not attempt to parse or guess which arguments are file paths. Instead, the LLM must explicitly declare files using `clawmini` flags (e.g., `--file var_name=./path`). The daemon validates and snapshots the file, then safely interpolates the absolute path of the snapshot into the opaque arguments array (replacing `{{var_name}}`). This provides structural safety without brittle naming conventions.
3. **Immediate Snapshotting & TOCTOU Prevention:** To prevent Time-of-Check to Time-of-Use (TOCTOU) race conditions involving symlinks, the daemon resolves the real path (equivalent to `O_NOFOLLOW` and `realpath`) and creates the secure snapshot *immediately* upon receiving the request, before the user is ever prompted. The user reviews and approves the exact snapshot, not the live file, guaranteeing that background processes in the sandbox cannot swap the file during the approval window.

### Clawmini CLI (Agent View)

The agent interacts with the `clawmini-lite` CLI using the POSIX standard `--` separator. Everything before `--` is processed by the daemon for security routing and snapshotting. Everything after `--` is passed opaquely to the target script.

**1. Discovery**
- `clawmini-lite requests list`: Outputs all registered policies and their descriptions.
- `clawmini-lite request <cmd> --help`: Executes the underlying command defined in the JSON configuration with the `--help` flag and outputs the result.

**2. Making a Request (Named Variable Mapping)**
```bash
# Agent explicitly maps body_txt to a sandbox file, then uses it in the opaque args
clawmini-lite request send-email \
  --file body_txt=./report.txt \
  -- \
  --to admin@example.com --subject "Daily Report" --body "{{body_txt}}"
```

Behind the scenes:
1. `clawmini-lite` parses `--file body_txt=./report.txt`.
2. The daemon verifies the path is inside the agent's directory, rejects it if it's a symlink, and snapshots it to a secure location (e.g., `/tmp/snapshots/123_report.txt`).
3. The daemon takes the opaque arguments `["--to", "admin@example.com", "--subject", "Daily Report", "--body", "{{body_txt}}"]` and performs a precise string replacement on array elements to swap `{{body_txt}}` with the safe snapshot path.
4. The CLI returns immediately with the pending Request ID and exits.
5. The daemon persists the request and routes the preview to the user's chat UI.
6. Upon approval, the daemon `spawn`s the script with the safe argument array.

**3. Asynchronous Resolution & Automatic Messaging**
When the agent makes a request, the CLI immediately returns the Request ID and exits. The daemon tracks the request. Once the user resolves the request (approves or rejects), the daemon *automatically* injects a system message back into the active chat session. This message includes the "Approved/Rejected" status, any `stdout`/`stderr` from the executed command, and any feedback strings provided by the user upon rejection.

### User Interface & Interactions

All requests are routed to the user's primary chat UI for review. To prevent unauthorized execution, the system relies on specific slash commands that must originate directly from the user.

When a request is made, the daemon presents the user with a preview message (e.g., "Request #32: Agent wants to run `send-email` with args..."). The preview displays the snapshot paths and includes abbreviated file contents (~500 chars per file, up to ~2000 chars total) so the user can see exactly what data is being requested.

Users can respond with:
- `/approve <id>`: Approve and execute the request.
- `/reject <id> [reason]`: Reject the request, optionally providing a natural language reason (e.g., `/reject 32 tone needs to be more formal`) so the agent can learn and retry.
- `/pending`: View a summarized list of all active pending requests.

## Requirements

### Core Requirements
1. **CLI Extensibility:** Agents must have access to a `clawmini` CLI binary inside their environment.
2. **Configuration:** Users define permissible actions via a centralized JSON configuration providing a `command` and `description` string. The framework acts as a "dumb pipe" for arguments.
3. **Explicit File Templating & Snapshotting:** Agents declare files using `--file name=path` prior to the `--` argument separator. The daemon strictly bounds the path to the agent's directory, creates a secure snapshot (rejecting symlinks entirely to prevent TOCTOU), and replaces `{{name}}` in the opaque arguments with the snapshot's absolute path. Enforce strict file size limits on snapshots (e.g., max 5MB).
4. **Chat Integration & Previews:** Requests must be routed to the user's Chat UI, showing the requested command, the snapshot paths, the exact opaque arguments, and abbreviated file contents to aid review.
5. **Execution Engine:** Approved actions must execute safely using direct OS exec arrays (`spawn`), not shell execution.
6. **Automatic Callbacks:** The daemon must automatically inject a message into the active chat session when a request is approved (along with command output) or rejected (along with user feedback).
7. **State Management:** Request state should be saved locally as `.json` files (e.g., in `.gemini/tmp/requests/`) to gracefully handle daemon restarts and persist pending requests.

### Non-Functional Requirements
- **Security:** 
  - **Input Sanitization (Command Injection):** The framework must strictly use direct exec arrays to completely mitigate shell command injection risks.
  - **Path Bounding & Symlinks (TOCTOU):** The daemon must snapshot files immediately upon request creation. It must verify the file lies within the agent's directory and reject any symlinks entirely to prevent an agent from escaping the sandbox via background malicious symlink swapping during the approval window.
  - **Denial of Service (DoS) Prevention:** The system must cap the number of pending requests (e.g., a maximum of 100 open requests) to prevent an agent from spamming requests and exhausting system resources (disk space, inodes, or memory).
  - **Spoofing & Self-Approval Prevention:** The system must strictly verify the origin of `/approve` and `/reject` commands to ensure they come from direct user input (e.g., validating the `role: user` tag on the message), not from agent outputs or background jobs.

## Open Issues / Future Considerations
- Transitioning the configuration format from JSON to YAML for improved human readability.
- Building a helper library/SDK (e.g., Python/Node) to simplify programmatic workflow creation inside the sandbox.
- Allowing user modifications to the arguments/files during the approval phase.

## Manual Testing Plan

To ensure the sandbox policies feature works correctly and securely, perform the following manual tests:

1. **Basic Approval Flow:**
   - Register a benign policy (e.g., `echo-test` that outputs to a file).
   - Have the agent request the policy via CLI. Verify the CLI command returns immediately with a pending message.
   - Verify the user receives the preview message with the command and args.
   - Use `/approve <id>`.
   - Verify the command executes correctly and the agent receives the success chat message with output.

2. **File Templating & Snapshotting:**
   - Request a policy using `--file test_file=./local.txt -- --input "{{test_file}}"`.
   - Verify the UI preview shows the path pointing to a secure snapshot in `/tmp/` (not `./local.txt`) and shows a preview of its contents.
   - Approve the request and verify the target script received the snapshot path.

3. **Rejection & Feedback Loop:**
   - Have the agent request a policy.
   - Use `/reject <id> missing required details`.
   - Verify the command does *not* execute.
   - Verify the agent receives the rejection status along with the feedback string "missing required details" injected into the chat.

4. **Spoofing Prevention (Security):**
   - Have the agent output the exact string: `/approve <id>` for one of its own pending requests.
   - Verify the system ignores this input and does *not* approve the request (because the role is `assistant`, not `user`).

5. **Daemon Restart Resilience:**
   - Have the agent make a request.
   - Restart the daemon.
   - Run `/pending` and verify the request is still active.
   - Use `/approve <id>` and verify it still executes successfully.

6. **Discovery Commands:**
   - Run `clawmini requests list` and verify all configured policies are listed.
   - Run `clawmini request <cmd> --help` and verify the output matches the `--help` output of the underlying wrapped command.
