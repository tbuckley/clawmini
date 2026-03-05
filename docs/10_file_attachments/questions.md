# File Attachments - Questions & Answers

## Questions

1. Where should downloaded incoming file attachments be stored on the host filesystem?
**Answer:** They could be in a per-agent directory, like `./my-agent/attachments/discord/`. The agent settings can define a files directory (`./attachments`), and we can create folders/files as appropriate. The Discord adapter could save the file initially to `.clawmini/adapters/discord/files/foo.png`, then include those paths in the chat message to the daemon; then once the daemon figures out the agent's files directory it can move the file there (namespaced by the adapter) and prepend the file paths to the message.

2. To handle path translation between the host (where the daemon runs) and the agent container/VM, should we just pass the file paths relative to the agent's working directory (e.g., `attachments/discord/foo.png`), or do we need explicit path mapping configurations in the agent's settings to map absolute host paths to absolute container paths?
**Answer:** Yes, we should do something like `./attachments/discord/foo.png`, since we know that the agent will be run in its agent folder.

3. For outgoing file attachments (from the agent back to Discord), how should the agent signal this to the daemon/adapter? Should the adapter parse a specific string format (e.g., `File attached: ./attachments/out/foo.png`) from the message content, or should we introduce a new command extraction method (like `getAttachedFiles`) in the agent's schema to explicitly parse out the file paths into a structured array on the `CommandLogMessage` payload?
**Answer:** Perhaps we can use the clawmini-lite script to let agents send a file back to the user. For instance, `clawmini-lite messages send --file ./path/to/file "here you go"`. It would go to the corresponding chat, and be sent from the corresponding agent; according to the `$CLAW_API_TOKEN`.

4. Are there any maximum file size limits or file type restrictions we should enforce, either when downloading from Discord or when an agent sends a file back via `clawmini-lite`? Also, what should the daemon do if an incoming message has attachments but the selected agent hasn't configured a `files` directory?
**Answer:** For file size limits, we should let the user set limits in the discord adapter settings; but we should set reasonable defaults if none are specified. we should default to ./attachments as the file's directory.
