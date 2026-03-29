# Product Requirements Document: Subagent Environment Policies

## Vision
To enhance the security and orchestration capabilities of Clawmini by ensuring that communication between agents operating in different isolated environments (sandboxes) is explicitly authorized. By treating cross-environment subagent messages as policy requests, users maintain absolute control over data flow and task delegation between differing privilege zones.

## Product / Market Background
As agents become more autonomous, they increasingly rely on delegating sub-tasks to specialized subagents. However, these subagents often operate in specialized environments (e.g., a highly privileged host environment vs. a strictly read-only networked sandbox). Without boundaries, an agent in a restricted environment could bypass its restrictions by sending an instruction to a subagent in an unrestricted environment. Implementing a formal "request-and-approve" workflow for cross-environment communication ensures that these system boundaries are strictly enforced without entirely removing the utility of multi-agent workflows.

## Use Cases
1. **Security Isolation:** An agent running in a locked-down web-browsing environment needs to execute a shell command. It attempts to spawn a subagent in the host environment. The system intercepts this and prompts the user for approval.
2. **Workflow Automation:** A user configures an automated pipeline where an agent in the `research` environment frequently delegates text summarization to an agent in the `compute` environment. The user updates `.clawmini/policies.json` to auto-approve messages from `research` to `compute`, streamlining the workflow without interactive prompts.
3. **Audit Trails:** A user wants to trace exactly which agent authorized another agent to execute a sensitive file modification. The cross-environment policy requests are logged in the chat history, creating a clear audit trail.

## Requirements

### 1. Environment Resolution
- The system MUST determine the environment of the source (calling) agent and the target (receiving) agent during a `subagentSpawn` or `subagentSend` operation.
- Environment resolution MUST be performed by evaluating each agent's configured working directory against the `environments` mapping in `.clawmini/settings.json`, finding the most specific matching path (using the existing `getActiveEnvironmentName` utility).
- If the source environment and target environment are identical (or both are `null` / un-sandboxed), the message MUST proceed immediately without policy intervention.

### 2. Policy Request Generation
- If the source and target environments differ, the system MUST intercept the spawn/send attempt and generate a new `PolicyRequest`.
- The `PolicyRequest` MUST be modeled using a special pseudo-command to leverage the existing policy architecture seamlessly:
  - For both spawns and sends: `@clawmini/subagent:<sourceEnv>:<targetEnv>`
  - (If an environment resolves to `null`, it can be represented as `host` or `none` in the command string, e.g., `@clawmini/subagent:none:sandbox`).
- The `args` array of the `PolicyRequest` MUST encapsulate the required data to fulfill the request upon approval (e.g., `["spawn", targetAgentId, targetSubagentId, prompt]` or `["send", targetSubagentId, prompt]`).

### 3. Auto-Approval via `policies.json`
- The system MUST allow users to auto-approve cross-environment communication by defining rules in `.clawmini/policies.json`.
- A user MUST be able to define a policy using the pseudo-command as the key, without needing to specify a `command` field:
  ```json
  "policies": {
    "@clawmini/subagent:research:compute": {
      "autoApprove": true
    }
  }
  ```
- This single policy MUST apply to both `subagentSpawn` and `subagentSend` operations.
- The directionality MUST be explicit. Approving `envA -> envB` DOES NOT imply approval for `envB -> envA`.
- If a matching auto-approve policy is found, the `PolicyRequest` is immediately approved, and execution proceeds automatically.
- (Note: The `PolicyDefinition` schema will need to be updated to make `command` optional).

### 4. Execution Flow and Blocking
- If the policy request is pending human approval, the behavior of the `subagentSpawn` and `subagentSend` APIs depends on the `async` flag:
  - **Synchronous (Not Async):** The API call MUST block and await the resolution of the `PolicyRequest`. If the user rejects the request, the API MUST return a failed result or throw a clear error (e.g., `TRPCError('FORBIDDEN', 'Policy request rejected')`) so the agent knows the delegation failed. If approved, the subagent execution begins, and the API resolves with the spawned/sent subagent ID.
  - **Asynchronous (Async):** The API call SHOULD queue the request and return immediately (returning the generated subagent ID). The actual subagent execution will only commence once the policy is approved asynchronously. (If rejected, the subagent status changes to `failed`).

## Security, Privacy, and Accessibility Concerns
- **Timeouts:** Blocking TRPC calls indefinitely can lead to network timeouts and broken agent loops. We may need to implement a mechanism where the API blocks up to a reasonable limit, or the client knows to poll the policy request status if the connection drops.
- **Spoofing:** Agents MUST NOT be able to spoof their source environment. The environment must be strictly resolved by the daemon based on the agent's verified working directory.
- **Payload Inspection:** The UI that presents the `PolicyRequest` to the user MUST clearly display the prompt being sent to the target agent so the user can make an informed decision before approving the cross-environment communication.
