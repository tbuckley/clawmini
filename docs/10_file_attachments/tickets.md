# File Attachments Implementation Tickets

## Ticket 1: Configuration Updates
**Description:** Update the configuration schemas for both the Agent and the Discord Adapter to support file attachments.
**Tasks:**
- Update `SettingsSchema` / `AgentSchema` to include a new optional `files` string property (defaulting to `"./attachments"`).
- Update `DiscordConfigSchema` to include an optional `maxAttachmentSizeMB` number property (defaulting to `25`).
**Verification:**
- Add unit tests validating the new properties and defaults in both schemas.
- Run `npm run format:check && npm run lint && npm run check && npm run test`.
**Status:** Complete

## Ticket 2: TRPC Schema and Discord Adapter Download
**Description:** Update the message payload schema to accept file paths and implement downloading incoming attachments in the Discord adapter.
**Tasks:**
- Extend the TRPC `sendMessage` payload schema to optionally include a list of temporary file paths.
- In `src/adapter-discord/index.ts` (or the relevant event handler), implement downloading of Discord `message.attachments` to a temporary directory (e.g., `.gemini/tmp/discord-files/`).
- Enforce the `maxAttachmentSizeMB` limit during the download process.
- Pass the downloaded temporary file paths to the daemon via the updated `sendMessage.mutate` TRPC call.
**Verification:**
- Write unit/integration tests for the Discord adapter verifying that attachments are correctly downloaded and size limits are respected.
- Run `npm run format:check && npm run lint && npm run check && npm run test`.
**Status:** Complete

## Ticket 3: Daemon Processing of Incoming Files
**Description:** Implement the daemon logic to intercept the incoming temporary files, move them to the agent's workspace, and format the user message.
**Tasks:**
- Update the daemon's message processing pipeline (e.g., `src/daemon/router.ts` or relevant message handler) to intercept `sendMessage` requests containing file paths.
- Resolve the target agent's `files` configuration directory.
- Move the temporary files to the agent's files directory, namespacing them by the adapter (e.g., `<agent_files_dir>/discord/<filename>`).
- Implement file name collision resolution (e.g., appending a timestamp or short UUID to duplicate filenames).
- Prepend or append the list of finalized relative file paths to the user's input message text before passing it to the agent.
**Verification:**
- Add unit tests for the daemon's file moving logic, collision resolution, and message text formatting.
- Run `npm run format:check && npm run lint && npm run check && npm run test`.
**Status:** Complete

## Ticket 4: Outgoing Files via CLI & Daemon (Agent to User)
**Description:** Enable agents to send files back to the user explicitly via the CLI, and update the daemon to record these paths.
**Tasks:**
- Update the `messages send` command in the `lite` CLI (`src/cli/commands/messages.ts` / `src/cli/lite.ts`) to accept a new `--file` argument.
- Update the underlying API/TRPC endpoint used by the CLI to accept and process this outgoing file path.
- In the daemon, implement path validation to ensure the provided file path does not contain directory traversal vulnerabilities (e.g., `../../`) and resolves within the agent's workspace.
- Update the internal chat log schema (e.g., `CommandLogMessage`) to store the explicit outgoing file path.
**Verification:**
- Add unit tests for the CLI's `--file` argument parsing.
- Add unit tests for the daemon's path traversal validation and log recording.
- Run `npm run format:check && npm run lint && npm run check && npm run test`.
**Status:** Complete

## Ticket 5: Discord Adapter Forwarding Outgoing Files
**Description:** Update the Discord adapter's forwarder to read outgoing file paths from the chat log and send them as Discord attachments.
**Tasks:**
- Update `src/adapter-discord/forwarder.ts` to detect when a new message/log from the daemon contains an outgoing file path.
- Read the file from the local filesystem.
- Modify the `dm.send()` call to include the file as an attachment (`files: [path]`) alongside the message content.
**Verification:**
- Add tests for the forwarder verifying that messages with attached file paths result in the correct `dm.send` payload.
- Run `npm run format:check && npm run lint && npm run check && npm run test`.
**Status:** Complete

## Ticket 6: Code Critique and Fixes
**Description:** Address DRY, YAGNI, naming, comments, and path violations in the initial file attachment implementation.
**Tasks:**
- High Priority: Update temporary download path for discord attachments to `.clawmini/adapters/discord/tmp` instead of `.gemini/tmp/discord-files`.
- Medium Priority: Fix DRY violation and bug in `src/daemon/router.ts` where `sendMessage` did not correctly respect `agent.directory` when resolving the target files directory.
- Medium Priority: Create a local `getUniquePath` utility in `src/daemon/router.ts` for DRYer renaming logic.
- Low Priority: Remove `JSON.stringify` workaround in `src/adapter-discord/index.ts` Debouncer instantiation by updating the `Debouncer` class to accept an optional custom `isEqual` function.
- Low Priority: Fix `any` typings in `src/adapter-discord/forwarder.ts` by using `MessageCreateOptions`.
- Low Priority: Fix flaky e2e test `should maintain atomic ordering of user and log messages with --no-wait`.
**Status:** Complete

## Ticket 7: Path Validation Security Enhancements
**Description:** Implement strict path validation and checks for incoming and outgoing file attachments to ensure security and prevent path traversal.
**Tasks:**
- Update `src/daemon/router.ts` (or relevant handler) for incoming files (`sendMessage` mutation):
  - Verify that all files in `input.data.files` exist on the filesystem.
  - Verify that all files are strictly within the `$WORKSPACE/.clawmini/tmp/` directory.
  - Verify that the target directory (`targetDir`) where files will be moved is strictly within `$WORKSPACE`.
- Update `src/daemon/router.ts` for outgoing files (`logMessage` mutation):
  - Ensure `input.file` is a relative path.
  - Ensure the file path resolves to a location within the agent's subfolder AND within `$WORKSPACE`.
  - Verify the file actually exists on the filesystem *before* resolving it to an absolute path and recording it.
- Ensure all relevant checks use a secure path comparison method (e.g., `pathIsInsideDir`).
**Verification:**
- Add unit tests verifying validation failures for absolute paths, non-existent files, files outside `.clawmini/tmp/` (for incoming), and files outside the agent folder/workspace (for outgoing).
- Run `npm run format:check && npm run lint && npm run check && npm run test`.
**Status:** Complete
