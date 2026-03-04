# Product Requirements Document (PRD): File Attachments

## 1. Vision
Enable seamless sharing of files and attachments between users (via Discord) and the backend agents executing inside containers or local environments. This functionality provides a crucial building block for multimodal interactions and more sophisticated workflows where agents manipulate, review, or generate binary/text artifacts.

## 2. Product/Market Background
Currently, the Discord adapter receives incoming text messages and forwards them to the Clawmini daemon. The daemon writes these to `chat.jsonl` and invokes the configured agent, capturing stdout/stderr as logs and text responses.
However, modern generative AI and bot interactions often involve files—such as sending a source code file to be debugged, an image to be analyzed, or requesting the bot to generate and return a PDF.

By supporting attachments natively:
- **Users** can simply upload files in Discord and get them analyzed by an agent.
- **Agents** can generate files (logs, assets, exported data) and send them explicitly back to the user on Discord.

## 3. Use Cases
- **User to Agent (Incoming):** A user drag-and-drops an image or a `.csv` file into a Discord DM. The agent receives the path to the file on its local filesystem, reads it, processes it, and returns an analysis in text.
- **Agent to User (Outgoing):** An agent is tasked with scraping a website and generating a `.zip` archive. Once complete, the agent uses the `clawmini-lite` CLI tool to send the archive directly back to the user on Discord alongside a confirmation message.

## 4. Requirements

### 4.1 Configuration Updates
1. **Agent Configuration (`SettingsSchema` / `AgentSchema`)**
   - Agents should support a new configuration property for defining the files directory, with a default of `./attachments`.
     - Example: `files: "./attachments"`

2. **Discord Adapter Configuration (`DiscordConfigSchema`)**
   - The Discord adapter should support configurable file size limits for incoming files to prevent abuse or disk space exhaustion.
   - New optional config values:
     - `maxAttachmentSizeMB`: e.g., default `25` (to match Discord's standard limits).

### 4.2 Incoming File Attachments (Discord -> Agent)
1. **Adapter Processing:**
   - On receiving a `MessageCreate` event with `message.attachments`, the Discord adapter will download the files to a local, temporary directory (e.g., `.clawmini/adapters/discord/files/`).
   - The adapter will construct a message payload to send to the daemon via TRPC (`sendMessage.mutate`) that includes both the user's text and a list of temporary file paths.
     - *Note: This implies extending the TRPC payload or embedding the file data/paths in a structured way.*

2. **Daemon Processing:**
   - The daemon intercepts the TRPC message containing the temporary file paths.
   - It resolves the target agent and determines the agent's `files` directory (defaulting to `./attachments`).
   - The daemon moves the temporary files from the adapter's directory to the agent's files directory, namespaced by the adapter (e.g., `./attachments/discord/<filename>`).
   - The daemon prepends or appends a standard reference to these files in the input message string provided to the agent:
     - Example format: `Attached files:
- ./attachments/discord/foo.png

<user message>`
   - The agent is then executed within its directory, allowing it to reliably find the files using the relative paths.

### 4.3 Outgoing File Attachments (Agent -> Discord)
1. **Agent Execution:**
   - Rather than parsing text logs for magic strings (e.g., `File attached:`), agents will use an explicit API via the `clawmini-lite` client to send files back to the user.
   - Example CLI usage: `clawmini-lite messages send --file ./attachments/out/foo.png "Here is your generated file."`

2. **Daemon / CLI Integration:**
   - The `clawmini-lite messages send` command will be updated to accept a `--file` flag.
   - It will use the `$CLAW_API_TOKEN` and `$CLAW_API_URL` to authenticate and route the file-sending request to the daemon.
   - The daemon will record a `CommandLogMessage` (or a new message type) in the `chat.jsonl` that explicitly defines the file path to be returned.

3. **Discord Adapter Forwarding:**
   - The `forwarder.ts` process, which subscribes to the `waitForMessages` TRPC endpoint, will read these new structured messages.
   - If a message contains an outgoing file path, it will verify the file exists locally and attach it to the Discord DM using `dm.send({ content: message.content, files: [filePath] })`.

### 4.4 Technical Constraints & Security
- **File Limits:** Enforce `maxAttachmentSizeMB` in the Discord adapter. If a file exceeds this limit, ignore it or notify the user.
- **Strict Path Validation (Incoming):** For incoming files, the daemon must verify that all provided temporary file paths exist and are strictly located within `$WORKSPACE/.clawmini/tmp/`. It must also ensure the target destination is within the `$WORKSPACE`.
- **Strict Path Validation (Outgoing):** For outgoing files logged by the agent, the daemon must ensure the file path is a relative path, that it resolves to a location within the agent's subfolder and the overall `$WORKSPACE`, and that the file actually exists before processing the log.
- **Path Traversal:** Ensure that file paths submitted by `clawmini-lite` or handled by the daemon do not allow directory traversal (e.g., `../../etc/passwd`). Validate that target paths stay within the `files` directory or the agent's workspace.
- **File Name Collisions:** If two files with the same name are uploaded, standard conflict resolution should occur (e.g., appending a timestamp or UUID to the filename before saving to the agent's directory).

## 5. Next Steps
- Expand the TRPC `sendMessage` schema to accept file paths.
- Update `adapter-discord` to handle downloads and configuration updates.
- Update the daemon router pipeline to process and move incoming files.
- Update `clawmini-lite` and the daemon to support explicit outbound file sharing.
- Update the `adapter-discord` forwarder to handle outbound files.
