# File Attachments - Research Notes

## Current Architecture
- Incoming messages from Discord are received in `src/adapter-discord/index.ts` via `Events.MessageCreate`.
- Only `message.content` is currently processed and added to the debouncer, then sent to the daemon via `trpc.sendMessage.mutate`.
- The daemon appends a `UserMessage` to the chat log (`chat.jsonl`).
- The agent is executed and logs the result as a `CommandLogMessage` (or a router log).
- `src/adapter-discord/forwarder.ts` subscribes to new messages via `trpc.waitForMessages`. It reads `CommandLogMessage` logs and forwards `message.content` via `dm.send()`.

## Missing Features for Attachments
1. **Downloading incoming attachments:**
   - Discord's `message.attachments` contains attachments.
   - We need to download them locally to a directory.
   - Proposed location: `[workspace_root]/.gemini/chats/[chatId]/files/` or a temporary directory like `.gemini/tmp/discord-files/`.
2. **Referencing attachments in the input message:**
   - Once downloaded, we need to append or prepend `File attached: <path>` to the user's message before sending it to the daemon.
3. **Path Translation:**
   - The user noted that the agent might be running in a VM/container with different absolute paths.
   - If we save the file to the host's `/home/user/workspace/discord-files/...` and pass this absolute path, the container won't find it.
   - **Solution ideas:**
     - Use relative paths from the workspace root (e.g., `.gemini/chats/default/files/file.txt`).
     - Introduce path mapping in the configuration (e.g., `pathMappings: [{ host: '/home/user/...', container: '/workspace/...' }]`).
4. **Outgoing attachments:**
   - The agent will output `File attached: <path>`.
   - The Discord adapter needs to parse this from the `content` or have it explicitly represented in the `CommandLogMessage` schema.
   - It will need to read the file from the filesystem and attach it using `dm.send({ files: [path] })`.

## Refined approach (Q1)
- Agent settings will define a `files` directory (e.g., `./attachments`).
- Discord adapter saves incoming files to a temporary location: `.clawmini/adapters/discord/files/foo.png`.
- The adapter includes the paths to these temp files in the RPC message sent to the daemon.
- The daemon intercepts these paths, moves the files into the agent's configured `files` directory, namespaced by the adapter (e.g., `./attachments/discord/foo.png`), and prepends these final relative/absolute paths to the user message.

## Refined approach (Q2)
- To avoid absolute path mapping issues for containerized agents, pass the file paths relative to the agent's working directory (e.g., `./attachments/discord/foo.png`), leveraging the fact that the agent executes within its specific folder.

## Refined approach (Q3)
- For outgoing files, instead of relying on parsing log messages, agents will use the `clawmini-lite` client to explicitly send a file back: `clawmini-lite messages send --file ./path/to/file "here you go"`.
- This API call will be authenticated via `$CLAW_API_TOKEN`, routed to the daemon, and appended to the chat, subsequently picked up by the adapter and sent to Discord.

## Refined approach (Q4)
- File limits: allow configuration in discord adapter settings, with reasonable defaults (e.g. 10MB or 25MB).
- Default agent files directory: `./attachments`.

## Path Validation Security Enhancements
Based on the new request, strict path validation is required for both incoming and outgoing files to ensure security and prevent path traversal or leaking arbitrary files.

**For incoming messages (User -> Agent):**
- In `sendMessage` TRPC endpoint (`src/daemon/router.ts`), before processing `input.data.files`:
  - Verify every file path exists.
  - Verify every file path is strictly located within `$WORKSPACE/.clawmini/tmp/`.
  - Verify that the target directory (`targetDir`) where files are being moved is strictly within `$WORKSPACE`.

**For outgoing files (Agent -> User):**
- In `logMessage` TRPC endpoint (`src/daemon/router.ts`), when processing `input.file`:
  - Ensure `input.file` is a relative path (e.g., does not start with `/` or `C:\`).
  - Ensure the resolved path is within the agent's designated directory.
  - Ensure the resolved path is within the overall `$WORKSPACE`.
  - Ensure the file actually exists on the filesystem *before* resolving it or recording it in the log message.
