# Adapter Filtering Notes

## Current State

*   **Config Files**: Both adapters use `zod` for configuration schemas (`DiscordConfigSchema` and `GoogleChatConfigSchema`). These are currently loaded once at startup.
*   **Message Filtering**: Both adapters currently share identical hardcoded filtering logic in their forwarders (`src/adapter-discord/forwarder.ts` and `src/adapter-google-chat/forwarder.ts`):
    ```typescript
    const isAgentDisplay =
      message.displayRole === 'agent' ||
      message.role === 'agent' ||
      message.role === 'legacy_log';

    if (isAgentDisplay && !message.subagentId) { ... }
    ```
*   **Input Handling**: 
    *   Discord: Uses `client.on(Events.MessageCreate, ...)` in `src/adapter-discord/index.ts`.
    *   Google Chat: Uses Pub/Sub `subscription.on('message', ...)` in `src/adapter-google-chat/client.ts`.
*   Commands sent to the adapter from chat are currently forwarded directly to the daemon via `trpc.sendMessage.mutate()`.

## Technical Considerations

1.  **Shared Logic**: Since the filtering logic and the `/show`, `/hide`, `/debug` commands apply to both adapters, we should extract a shared filtering/command module, likely into `src/shared/`.
2.  **Config Reloading**: Because `config.json` is updated by `/show` and `/hide`, the forwarders will need a way to see the latest rules. We can either have the forwarder re-read the config file per-message (or per-batch), or update an in-memory config reference when the command is processed.
3.  **Ignored Messages Storage**: For `/debug <N>` to work, we need to keep a buffer of ignored messages. Since it's for debugging, an in-memory rolling buffer (e.g., last 100 messages) in the adapter process is likely sufficient.
4.  **Subagent Formatting**: If subagents are enabled (`subagent: true` or `all: true`), messages directed to or originating from subagents need to be formatted with `[To:<id>]` and `[From:<id>]` or simply `[<id>]`.
