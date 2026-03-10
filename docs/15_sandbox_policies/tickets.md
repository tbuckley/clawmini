# Sandbox Policies Tickets

This document breaks down the implementation of the Sandbox Policies feature into ordered, self-contained milestones.

## Ticket 1: Core Configuration and Request State Management

**Description:** Define the data structures for policy configurations and requests, and implement persistent state management for requests so they survive daemon restarts.
**Tasks:**

- Define TypeScript types for `policies.json` configuration.
- Define types for Request states (`Pending`, `Approved`, `Rejected`).
- Implement a `RequestStore` service that saves, loads, and lists requests from a persistent directory (e.g., `.gemini/tmp/requests/`).
  **Verification:**
- Write unit tests for `RequestStore` verifying save, load, list operations, and graceful handling of corrupted files.
- Run `npm run format:check && npm run lint && npm run check && npm run test`.
  **Status:** completed

## Ticket 2: File Snapshotting and Security Layer

**Description:** Implement the core security mechanisms to prevent TOCTOU attacks and command injection.
**Tasks:**

- Implement a secure file snapshotting utility that takes a requested file path, resolves its realpath (preventing symlink attacks), verifies it is within the allowed sandbox/workspace, and copies it to a secure temporary directory.
- Implement argument interpolation logic to safely replace named variables (e.g., `{{file_var}}`) in an arguments array with the absolute paths of the generated snapshots.
- Create a safe execution wrapper using `spawn` (direct exec array, no shell concatenation).
  **Verification:**
- Write unit tests for the snapshotting utility, specifically testing path traversal attempts and symlink resolution.
- Write unit tests for the argument interpolation logic.
- Run `npm run format:check && npm run lint && npm run check && npm run test`.
  **Status:** completed

## Ticket 3: Daemon Request Service

**Description:** Build the central service within the daemon that processes incoming requests, utilizing the security layer and state management.
**Tasks:**

- Create a `PolicyRequestService` that receives raw request data (command name, file mappings, opaque args).
- Integrate the file snapshotting and argument interpolation into the service.
- Enforce the maximum limit of pending requests (e.g., max 100 open requests) to prevent DoS.
- Store the resulting pending request using the `RequestStore`.
  **Verification:**
- Write unit tests for `PolicyRequestService`, ensuring it correctly coordinates snapshotting and storage, and properly rejects requests when the pending limit is reached.
- Run `npm run format:check && npm run lint && npm run check && npm run test`.
  **Status:** completed

## Ticket 4: CLI Agent Commands

**Description:** Expose the sandbox policies to the agent via the `clawmini` CLI.
**Tasks:**

- Implement `clawmini requests list` to fetch and display available policies and descriptions.
- Implement `clawmini request <cmd> --help` to execute the underlying command with `--help` and print the output.
- Implement `clawmini request <cmd> [--file name=path...] -- [args...]` to parse inputs and submit the request to the `PolicyRequestService` in the daemon, returning the Request ID immediately.
  **Verification:**
- Write tests for the CLI commands, verifying correct argument parsing (especially the `--` separator) and interaction with the daemon service.
- Run `npm run format:check && npm run lint && npm run check && npm run test`.
  **Status:** completed

## Ticket 5: Chat UI Routing and User Slash Commands

**Description:** Surface requests to the user for review and provide commands to act on them.
**Tasks:**

- Implement logic to intercept new pending requests and route a preview message to the Chat UI.
- The preview message must include the command, the opaque arguments, and abbreviated contents (~500 chars) of any snapshotted files.
- Implement user slash commands: `/approve <id>`, `/reject <id> [reason]`, and `/pending`.
- Implement strict spoofing prevention: ensure these commands only trigger if the message originates from the user (`role: user`).
  **Verification:**
- Write unit tests for the preview message generation (ensuring files are abbreviated correctly).
- Write tests for the slash commands, explicitly testing the spoofing prevention mechanism.
- Run `npm run format:check && npm run lint && npm run check && npm run test`.
  **Status:** completed

## Ticket 6: Execution and Feedback Loop

**Description:** Complete the workflow by executing approved requests and notifying the agent of the outcome.
**Tasks:**

- Connect the `/approve` command to the safe execution wrapper (`spawn`) implemented in Ticket 2.
- Implement an automatic feedback mechanism that injects a system/tool message back into the active chat session upon resolution.
- For approvals: include the `stdout`/`stderr` of the executed command.
- For rejections: include the user's rejection reason (if provided).
  **Verification:**
- Write integration tests simulating the full end-to-end flow: request creation -> user approval -> execution -> feedback injection.
- Write integration tests for the rejection flow.
- Run `npm run format:check && npm run lint && npm run check && npm run test`.
  **Status:** completed

## Ticket 7: Code Review Fixes

**Description:** Address code review feedback to improve performance and code quality.
**Tasks:**

- **High Priority:** In `src/daemon/routers/slash-policies.ts`, use `store.load(id)` instead of `store.list().find()` to fetch single requests in `/approve` and `/reject`, avoiding O(N) file reads.
- **Medium Priority:** In `src/daemon/request-store.ts`, extract the duplicated `ENOENT` error checking logic into a reusable helper function to adhere to DRY principles.
- **Low Priority:** In `src/cli/commands/request.ts`, simplify the opaque arguments fallback logic for argument extraction.
  **Verification:**
- Run `npm run format:check && npm run lint && npm run check && npm run test`.
  **Status:** completed

## Ticket 8: Policy Utils Improvements

**Description:** Address security and maintainability feedback for snapshotting utilities.
**Tasks:**

- Define the maximum snapshot size (5MB) as a named constant in `src/daemon/policy-utils.ts`.
- Update `createSnapshot` to receive the agent's directory instead of the workspace root, and strictly verify the file is within the agent's directory.
- Refactor snapshot generation to reject symlinks completely using `fs.lstat` instead of resolving them to prevent TOCTOU attacks.
- Ensure the newly generated unique snapshot filename does not already exist before copying.
  **Verification:**
- Update and run unit tests for `policy-utils.ts` to assert symlinks are rejected and the agent directory is respected.
- Run `npm run format:check && npm run lint && npm run check && npm run test`.
  **Status:** completed

## Ticket 9: Policy Request Metadata & Validation Enhancements

**Description:** Improve request ID generation and data integrity.
**Tasks:**

- Update request ID generation to use a short, typing-friendly string (e.g., 3 random alphanumeric characters) instead of UUIDs.
- Update `PolicyRequest` to include `chatId` and `agentId`, and populate these fields upon request creation in `policy-request-service.ts`.
- Update `request-store.ts` to validate the incoming JSON schema using Zod when loading requests from disk.
  **Verification:**
- Update unit tests for `policy-request-service.ts` and `request-store.ts` to assert ID format, metadata presence, and Zod validation.
- Run `npm run format:check && npm run lint && npm run check && npm run test`.
  **Status:** completed

## Ticket 10: Router State & Configuration Fixes

**Description:** Fix router pipeline handling to ensure processes are not incorrectly killed and that agents receive the correct feedback messages.
**Tasks:**

- Modify `src/daemon/routers.ts` to make `slash-policies` a dynamically loaded router (added via config) rather than a hardcoded step, and remove inline `await import(...)` statements by moving them to top-level imports.
- Update `slash-policies.ts` to ensure `action: 'stop'` is no longer returned for `/approve`, `/reject`, or error cases.
- For approvals/rejections, update the `state.message` so the agent receives the correct confirmation/output string, and return it without stopping the pipeline.
- For user errors (e.g., missing ID), set `state.reply` and return an empty `message`.
- Ensure `appendMessage` is provided with the correct `replyTo` parameter targeting the user's incoming message ID.
- During approval/rejection, verify that the `req.chatId` matches the current `state.chatId`.
  **Verification:**
- Run integration tests simulating the new router behavior, verifying the agent message generation and that the pipeline does not stop.
- Run `npm run format:check && npm run lint && npm run check && npm run test`.
  **Status:** not started

## Ticket 11: CLI Commands Relocation

**Description:** Move the sandbox request commands to the lite CLI so they are accessible by the agent.
**Tasks:**

- Relocate `requestCmd` and `requestsCmd` from `src/cli/index.ts` to `src/cli/lite.ts`.
  **Verification:**
- Manually run `clawmini-lite --help` to verify the `request` commands are present.
- Run `npm run format:check && npm run lint && npm run check && npm run test`.
  **Status:** not started
