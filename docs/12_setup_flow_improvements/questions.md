# Questions for Setup Flow Improvements

1. **Workspace Default Chat**: When `clawmini init --agent <name>` runs, should it also set the default workspace chat (`settings.chats.defaultId`) to `<name>`? Currently it defaults to `"default"`.
   - **Answer:** Yes, also set that agent for the default chat.
2. **Missing Flags**: If the user passes `--agent-template` but omits `--agent`, should `clawmini init` throw an error, use a default agent name (like `"default"` or `"main"`), or generate a random one?
   - **Answer:** Throw an error.
3. **Existing Chat Settings**: The instruction says "create a chat... (if none exists), and set that agent as the defaultAgent for the chat." If the chat *already exists*, should we still update its `defaultAgent` to the newly created agent, or should we leave its settings untouched?
   - **Answer:** Leave it untouched; show a warning that a chat with that name already exists.