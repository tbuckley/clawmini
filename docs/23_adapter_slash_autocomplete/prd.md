# Product Requirements Document: Adapter Slash Command Autocomplete

## 1. Vision
To enhance the usability and discoverability of Clawmini's core features by integrating native platform slash commands into chat clients. By providing autocomplete for built-in routers and adapter-level commands in Discord and Google Chat, users will no longer need to memorize command names or precise syntax to interact effectively with the agent.

## 2. Product & Market Background
Users operating Clawmini through chat platforms (Discord and Google Chat) often rely on `/` prefixed commands to manage sessions (e.g., `/new`, `/stop`), moderate policy requests (e.g., `/approve`, `/reject`, `/pending`), and debug adapter configurations (e.g., `/show`, `/hide`, `/debug`). Currently, these platforms treat these as regular text messages unless explicitly registered via their respective APIs. Without native integration, users lack the discoverability and guided argument entry that modern chat applications typically provide via a popup menu when typing `/`. 

## 3. Use Cases
*   **Discoverability:** A user types `/` in a Discord channel where Clawmini is present and immediately sees a list of available commands like `/new` or `/pending`, without needing external documentation.
*   **Guided Argument Entry:** A user wants to reject a pending action. They type `/reject` and the platform prompts them for `[policy_id]` and an optional `[rationale]`, making the required data format obvious.
*   **Platform Nativity:** A user clicks a slash command from the autocomplete menu and hits enter. The platform natively formats the command, reducing typos.

## 4. Requirements

### 4.1 Discord Adapter
*   **Startup Registration:** The adapter must automatically sync a predefined list of slash commands with the Discord API (using `applicationCommands`) when the bot logs in (`client.on('ready')`).
*   **Command Set:** The following commands must be registered with their appropriate descriptions and arguments (using `SlashCommandBuilder` or raw JSON options):
    *   `/new`: Start a new session. Optional `STRING` argument: `message`.
    *   `/stop`: Stop the current generation.
    *   `/approve`: Approve a pending policy request. Required `STRING` argument: `policy_id`.
    *   `/reject`: Reject a pending policy request. Required `STRING` argument: `policy_id`. Optional `STRING` argument: `rationale`.
    *   `/pending`: List pending policy requests.
    *   `/show`: Show filtered UI elements. Optional `STRING` argument: `all`.
    *   `/hide`: Hide filtered UI elements. Optional `STRING` argument: `all`.
    *   `/debug`: Toggle debug view or show debug for a message. Optional `STRING` argument: `message_id`.
*   **Interaction Handling:** The Discord adapter must listen for `interactionCreate` events where `interaction.isChatInputCommand()` is true.
    *   When invoked, the adapter should reconstruct the equivalent text command string (e.g., `/reject req-123 my reason`) and pipe it into the existing `handleAdapterCommand` or routing logic, or process it directly if that's cleaner. 
    *   It must acknowledge the interaction appropriately (e.g., using `interaction.reply` or deferring).

### 4.2 Google Chat Adapter
*   **Documentation Only:** Since Google Chat requires static registration of slash commands via the Google Cloud Console (and does not provide a dynamic, unprivileged API to register them at runtime like Discord), the solution for this platform will be documentation.
*   **Setup Guide Updates:** The `docs/guides/` or README documentation must be updated to provide explicit instructions on how users can manually configure the slash commands in the Google Cloud Console.
    *   The guide should list the exact Command Names (e.g., `/new`, `/approve`), suggested Command IDs, and Descriptions to configure.
    *   The adapter's existing text-based message parsing for `/` commands will continue to handle these invocations when the user selects them from the Google Chat autocomplete menu (which sends a `type: MESSAGE` event containing the text and slashCommand annotations).

### 4.3 General
*   **Existing Text Parsing:** The existing text-based `/` command handlers MUST remain functional, as users may still manually type the commands (especially in Google Chat) or use legacy clients. The new native slash commands should act as an alternative entry point that wraps or feeds into the same underlying logic.

## 5. Privacy & Security Concerns
*   No new sensitive information is collected.
*   Discord slash command registration is a standard API feature and requires the application to be invited with `applications.commands` scope (which is already standard for Discord bots).

## 6. Implementation Notes
*   **Discord `discord.js`:** The `REST` module from `discord.js` should be used to `put` the commands to `Routes.applicationCommands(clientId)`.
*   No dynamic autocomplete for *arguments* (e.g. suggesting specific policy IDs while typing) is required at this time. Standard option definitions are sufficient to trigger the base platform UI.