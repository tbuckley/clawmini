# Auto Approve Policy

## Vision
To streamline AI agent workflows by allowing trusted sandbox policies to execute automatically without requiring manual user approval for every invocation. This reduces friction for repetitive or low-risk tasks while maintaining the security benefits of the centralized policy configuration framework.

## Product/Market Background
The current Sandbox Policies feature forces a "request-and-approve" workflow for every single action configured in `policies.json`. While this is excellent for security and preventing unauthorized access, it can significantly slow down development workflows when an agent is performing repetitive, low-risk tasks that the user already trusts (e.g., running `npm install` or executing a specific test suite).

By introducing an `autoApprove` flag to the policy configuration, users can selectively bypass the manual approval step for specific policies. This provides a balance between strict security for sensitive operations and frictionless automation for routine tasks.

## Use Cases
1. **Frictionless Testing:** A user configures a `run-tests` policy that executes the local test suite. Since running tests is read-only and safe, they mark it as `autoApprove: true`. When the agent is refactoring code and needs to verify its changes, it requests `run-tests`. The command executes immediately, and the agent receives the test output without the user having to intervene in the chat interface.
2. **Routine Package Management:** A user is allowing the agent to scaffold a new project and configure dependencies. They mark the `npm-install` policy as `autoApprove: true` temporarily. The agent can freely run `npm install` to resolve dependencies without pausing the workflow to wait for manual approval.
3. **Auditable Automation:** An agent performs an auto-approved action. Even though the user wasn't prompted to approve it, a `debug` message is injected into the chat history. If the user later reviews the conversation, they can see exactly when and what policy was automatically executed.

## Requirements

### Functional Requirements
1. **Configuration Update:** The `policies.json` schema must be updated to support an optional `autoApprove` boolean field on each policy definition.
2. **Immediate Execution:** If a requested policy has `autoApprove: true`:
   - The daemon must immediately execute the command (safely using `executeSafe`).
   - The CLI command `clawmini-lite request <cmd>` must *block* and wait for the execution to complete.
   - The CLI command must output the results (stdout/stderr/exit code) directly back to the agent via its standard output streams.
3. **State Management:** The generated request must be saved to the database/disk with its state immediately set to `Approved`.
4. **Audit Logging:** An automatic `debug` level message must be injected into the chat history stating that the policy was auto-approved and executed (e.g., `[Auto-approved] Policy <name> was executed`).
5. **Backwards Compatibility:** Policies without the `autoApprove` flag must continue to function exactly as they do today (entering the `Pending` state and returning immediately to the CLI while injecting an approval request into the chat).

### Non-Functional Requirements
1. **Performance:** Auto-approved policies must not introduce unnecessary artificial delays (e.g., no polling). The execution and response should be as fast as a direct shell command execution overhead allows.
2. **Extensibility:** The type definitions and parsing logic for `autoApprove` should be implemented such that it is easy to change `boolean` to `boolean | string` in the future for dynamic evaluation scripts.

## Security, Privacy, and Accessibility Concerns
- **Security:** This feature intentionally weakens the security model for specific commands by removing the human-in-the-loop requirement. It is critical that `autoApprove` defaults to `false` (or is omitted) and that documentation clearly warns users of the risks of auto-approving policies that modify state or access sensitive networks.
- **Auditing:** Because the user is no longer actively approving these actions, the `debug` level chat messages are essential for post-hoc auditing. Without them, an agent could maliciously or accidentally abuse an auto-approved policy without the user realizing it until much later.