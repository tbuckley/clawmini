# Tickets: Adapter Slash Command Autocomplete

## Step 1: Define Discord Slash Commands
- **Description:** Create a module or configuration defining the supported slash commands (`/new`, `/stop`, `/approve`, `/reject`, `/pending`, `/show`, `/hide`, `/debug`) and their arguments (e.g., `policy_id` for `/approve`, `rationale` for `/reject`) using `discord.js` structures.
- **Verification:** Add unit tests to verify the command structures are correctly defined. Run `npm run validate`.
- **Status:** Completed

## Step 2: Register Commands on Discord Startup
- **Description:** Update the Discord adapter's initialization logic (`client.on('ready')`) to register the defined slash commands globally using `REST` and `Routes.applicationCommands(clientId)` from `discord.js`.
- **Verification:** Add unit tests to ensure the registration API is called correctly upon client ready. Run `npm run validate`.
- **Status:** Completed

## Step 3: Handle Discord Slash Command Interactions
- **Description:** Add an event listener for `interactionCreate` in the Discord adapter. If `interaction.isChatInputCommand()` is true, reconstruct the equivalent text command (e.g., `/reject req-123 my reason`) and pipe it into the existing text command logic. Ensure the interaction is appropriately acknowledged (`interaction.reply` or `interaction.deferReply`).
- **Verification:** Add unit tests to simulate `interactionCreate` events and verify they are correctly parsed, routed, and acknowledged. Run `npm run validate`.
- **Status:** Completed

## Step 4: Document Google Chat Slash Commands Setup
- **Description:** Update the documentation (e.g., `README.md` or a new guide in `docs/guides/`) to provide explicit instructions on how users can manually configure these slash commands (Command Names, IDs, and Descriptions) in the Google Cloud Console for Google Chat.
- **Verification:** Manually review the generated markdown documentation for clarity and completeness.
- **Status:** Completed
