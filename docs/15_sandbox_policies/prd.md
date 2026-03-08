# Product Requirements Document: Sandbox Policies

## Vision
To provide a secure, extensible framework that empowers AI agents to request and execute sensitive or network-dependent operations safely from within a restricted sandbox. By enabling asynchronous, user-approved requests, agents can seamlessly improve their own workflows without compromising system integrity.

## Product/Market Background
AI agents often operate within highly restricted sandbox environments to prevent unintended destructive actions or unauthorized network communication. However, this safety comes at the cost of utility; an agent might deduce a solution that requires network access (e.g., sending an email or moving a file to a networked read-only volume) but is unable to act on it. By introducing a formal "request-and-approve" policy workflow, users retain full control via a familiar chat interface, while agents gain the ability to perform complex, privileged tasks.

## Use Cases

### 1. Moving Files to a Network-Enabled Directory
An agent needs to compile or transfer a file into a read-only area accessible by network-enabled host commands (e.g., `/home/users/has-network`). The agent generates the file and requests permission to move it. The user reviews the request and approves the move. (Note: Binaries are generally not supported for these workflows).

### 2. Sending an Email
An agent compiles a status report and wants to email it to stakeholders. It uses the CLI to request permission to send the email, specifying the addresses, subject, and body. The user previews the requested action in their chat UI and approves the action, which executes either on the host or inside a restricted proxy.

### 3. Agent Workflow Orchestration
An automated script inside the sandbox coordinates a multi-step process. It makes an approval request, and the CLI returns immediately. The agent relies on an automatically injected chat message from the daemon to know when the request is approved or rejected before proceeding with the next steps in its conversation.

## Inspirational Flow Example

The following scenario illustrates an end-to-end interaction using this feature:

1. **Discovery:** The user tells the LLM about a new capability. The LLM calls `clawmini requests list` to see what is available, along with descriptions.
2. **Schema Generation:** The LLM then calls `clawmini requests send-email --help` to learn about the command's arguments and automatically creates a Skill for itself.
3. **Execution Request:** On a user's request, the LLM calls `clawmini requests send-email --to foo@bar.com --subject hi --body ./body.txt`.
4. **Agent Acknowledgment:** The agent immediately receives a message back on the CLI: *"Submitted request (ID: 32), you will get a message in the chat if the user approves or rejects."* The daemon stores the request on disk (as a `.json` file) to survive restarts.
5. **User Preview & Decision:** The user sees a message in their chat interface: *"Request #32: Agent wants to run `send-email` with args: `--to foo@bar.com --subject hi --body ./body.txt`... use `/approve 32` or `/reject 32`..."*
6. **Resolution:** The user responds with `/reject 32 make it more formal`. (The system verifies this command originated from the user, not the agent).
7. **Agent Feedback Loop:** The daemon automatically injects a message into the chat: `[Request 32] User rejected with message: make it more formal`. The agent can then adjust its inputs and try again.

## Proposed Experience & CLI Design

### Registration (JSON Configuration)
Users will register new commands in a concise JSON configuration file (e.g., `policies.json`). To keep the system simple and flexible, we want to keep logic out of the configuration file. Users will manually create and edit this configuration.

Instead of writing scripts inside the JSON, actions simply point to an executable file (e.g., a `.sh`, `.py`, or `.js` script). To simplify argument passing and avoid rigid formatting rules, the configuration allows defining a single list of `params`. Any parameter name ending in `-snapshot` (e.g., `--body-snapshot`) will be treated as a file path that requires snapshotting and path-bounding validation. This removes the need to enforce strict spacing or separate parameter lists.

**Security & Sanitization Strategy:**
To prevent Command Injection and other vulnerabilities, the system will *not* naively pass raw strings to a shell. 

**Direct Exec (Bypassing Shell):** The framework must implement strict execution boundaries by executing commands directly via an exec array (e.g., `spawn('script.sh', ['--to', value])`) rather than a concatenated shell string. This ensures that all arguments are passed safely to the underlying OS APIs as pure data, completely mitigating shell injection attacks (like `&& rm -rf /`).

*MVP Phase 2 (Snapshotting & Path Bounding):* TOCTOU (Time-of-Check to Time-of-Use) prevention is a core requirement of the MVP, sequenced immediately after the foundational request/approve flow is established. When a request is made, the system will snapshot any files referenced by arguments ending in `-snapshot`. The user will review these exact snapshots. **Crucially, the system will strictly verify that all `-snapshot` paths resolve to a location *within* the agent's permitted sandbox directory to prevent path traversal attacks (e.g., `../../etc/shadow`), making sure to resolve symlinks during this validation.** Upon approval, the system executes the command, substituting the original sandbox paths with the local snapshot paths.

```json
{
  "actions": {
    "promote-file": {
      "description": "Move a file to the network-enabled read-only area.",
      "params": ["--destination", "--source-snapshot"],
      "execute": {
        "environment": "host",
        "command": "./scripts/promote-file.sh"
      }
    },
    "send-email": {
      "description": "Send an email.",
      "params": ["--to", "--subject", "--body-snapshot"],
      "execute": {
        "environment": "sandbox",
        "command": "./scripts/send-email.py"
      }
    }
  }
}
```

### Clawmini CLI (Agent View)

The agent interacts with the `clawmini` CLI to discover, create, and monitor requests. All arguments are passed opaquely to the underlying script.

**1. Discovery**
The agent can query available sandbox policies to construct its toolset dynamically:
- `clawmini requests list`: Outputs all registered policies and their descriptions.
- `clawmini requests <cmd> --help`: Outputs the expected arguments (`params`), allowing the agent to generate a valid schema or Skill definition.

**2. Making a Request**
```bash
# Agent wants to promote a file
clawmini request promote-file --source-snapshot ./script.sh --destination script.sh
```

Behind the scenes:
1. The daemon records the request.
2. The user approves the request based on the provided arguments.
3. The daemon executes `./scripts/promote-file.sh --source ./script.sh --destination script.sh`.

```bash
# Agent wants to send an email
clawmini request send-email --to admin@example.com --subject "Daily Report" --body-snapshot ./report.txt
```
*Outputs a Request ID (e.g., `32`).*

**3. Asynchronous Resolution & Automatic Messaging**
When the agent makes a request, the CLI immediately returns the Request ID and exits. The daemon tracks the request. Once the user resolves the request (approves or rejects), the daemon *automatically* injects a system message back into the active chat session. This message includes the "Approved/Rejected" status, any `stdout`/`stderr` from the executed command, and any feedback strings provided by the user upon rejection.

### User Interface & Interactions

All requests are routed to the user's primary chat UI for review. To prevent unauthorized execution, the system relies on specific slash commands that must originate directly from the user.

When a request is made, the daemon presents the user with a preview message (e.g., "Request #32: Agent wants to run `send-email` with args..."). Users can respond with:
- `/approve <id>`: Approve and execute the request.
- `/reject <id> [reason]`: Reject the request, optionally providing a natural language reason (e.g., `/reject 32 tone needs to be more formal`) so the agent can learn and retry.
- `/pending`: View a summarized list of all active pending requests.

## Requirements

### Core Requirements
1. **CLI Extensibility:** Agents must have access to a `clawmini` CLI binary inside their environment.
2. **Configuration & Security:** Users define permissible actions via a centralized JSON configuration specifying `params`. Arguments ending in `-snapshot` indicate sandbox paths that require security validation and snapshotting. The framework enforces secure execution (via direct exec arrays) to prevent command injection. User manages this JSON file manually.
3. **Snapshotting & Path Bounding (MVP Phase 2):** Any file referenced by `-snapshot` arguments must strictly resolve to a location *inside* the agent's sandbox (preventing path traversal, with symlinks fully resolved). Validated files are snapshotted to a local daemon-managed directory to eliminate TOCTOU risks. Enforce strict file size limits on snapshots (e.g., max 5MB).
4. **Chat Integration & Previews:** Requests must be routed to the user's Chat UI, showing the requested command and arguments.
5. **Execution Engine:** Approved actions must execute safely according to the policy.
6. **Automatic Callbacks:** The daemon must automatically inject a message into the active chat session when a request is approved (along with command output) or rejected (along with user feedback).
7. **State Management:** Request state should be saved locally as `.json` files (e.g., in `.gemini/tmp/requests/`) to gracefully handle frequent daemon restarts and persist pending requests.

### Non-Functional Requirements
- **Security:** 
  - **Input Sanitization:** The framework must safely handle user inputs, strictly using direct exec arrays to completely mitigate command injection risks. 
  - **Path Bounding & Symlinks:** All requested file paths must be strictly validated to remain within the agent's restricted directory. **Crucially, path validation must resolve all symlinks** before checking boundaries to prevent an agent from escaping the sandbox via malicious symlinks (e.g., pointing to `/etc/shadow`).
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
   - Have the agent request the policy.
   - Verify the user receives the preview message with the command and args.
   - Use `/approve <id>`.
   - Verify the command executes correctly and the agent receives the success chat message with output.

2. **Rejection & Feedback Loop:**
   - Have the agent request a policy.
   - Use `/reject <id> missing required details`.
   - Verify the command does *not* execute.
   - Verify the agent receives the rejection status along with the feedback string "missing required details" in the chat.

3. **Spoofing Prevention (Security):**
   - Have the agent output the exact string: `/approve <id>` for one of its own pending requests.
   - Verify the system ignores this input and does *not* approve the request (because the role is `assistant`, not `user`).

4. **Daemon Restart Resilience:**
   - Have the agent make a request.
   - Restart the daemon.
   - Run `/pending` and verify the request is still active.
   - Use `/approve <id>` and verify it still executes successfully.

5. **Discovery Commands:**
   - Run `clawmini requests list` and verify all configured policies are listed.
   - Run `clawmini requests <cmd> --help` and verify the expected `params` are accurately displayed.