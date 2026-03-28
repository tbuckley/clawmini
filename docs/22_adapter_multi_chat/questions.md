# Questions

1. **Explicit Routing Syntax:** To allow users to specify a chat or agent for a channel, what syntax should be used?
   - **Answer:** We generally use slash commands, so `/chat <id>` or `/agent <id>`. If we use `/agent <id>`, we should create a new chat named `<agent-id>-<adapter-name>-1` and display it to the user so they know which chat it is.

2. **New Contexts Default Behavior:** When a user sends a message in a *new* Discord channel or Google Chat space (where no mapping exists yet), what is the default behavior?
   - **Answer:** The first message from a user (if not a `/chat` or `/agent` command) should be ignored in terms of passing it to the daemon. Instead, the bot should reply telling the user to use `/chat` or `/agent` to configure the channel, or inform them that if they continue talking, it will use the default chat (and explicitly state which chat that is).

3. **Discord Scope:** In Discord, should we respond to *all* messages in a channel from authorized users, or only when the bot is `@mentioned`?
   - **Answer:** We will respond to all messages from the authorized user in the mapped channel without requiring a `@mention`, as the new-channel onboarding flow explicitly tells them they can "continue talking" to use the default chat. (Bot and unauthorized user messages will continue to be ignored).

4. **Validation API:** To validate if a user-specified chat or agent exists, should the adapters use new or existing TRPC queries (e.g., `trpc.getChats` / `trpc.getAgents`)?
   - **Answer:** Using the existing list queries (`trpc.getChats` / `trpc.getAgents`) is fine because there won't be a massive number of entities to filter through.

5. **Mapping Storage:** Should the mapping of `(Adapter Channel/Space ID) -> (Daemon Chat ID)` be stored in the adapter's local `state.json`?
   - **Answer:** Yes, it should be added to the adapter's existing `state.json`.