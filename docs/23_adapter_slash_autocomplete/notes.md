# Research Notes: Adapter Slash Autocomplete

## Discord Adapter
- Currently, the Discord adapter listens for messages starting with `/` but does not seem to register them as official Discord Application Commands (Slash Commands).
- To support autocomplete and a native `/` menu, the bot must register "Application Commands" via the Discord API (typically via HTTP PUT to `/applications/{application.id}/commands` or guild-specific equivalents).
- Discord slash commands support autocomplete for `STRING`, `INTEGER`, and `NUMBER` options, firing an `INTERACTION_CREATE` event with `type: 4` when a user types, allowing up to 25 choices to be returned within 3 seconds.

## Google Chat Adapter
- Currently, the Google Chat adapter also parses `/` prefix messages.
- Google Chat supports native slash commands, but they must be registered in the Google Cloud Console under the Google Chat API Configuration.
- Google Chat API documentation indicates that Slash Commands can be configured with a Command ID and Description. When invoked, they send a specific `type: MESSAGE` event with a `slashCommand` object.
- Autocomplete in Google Chat happens automatically based on the registered commands in the console. There is no dynamic "on-typing" autocomplete API for Google Chat that lets the bot return choices in real-time, unlike Discord. The autocomplete just filters the pre-registered list of commands.

## Requirements from Prompt
- Built-in routers: `/new`, `/stop`, `/approve`, `/reject`, `/pending`.
- Adapter-level commands: `/show`, `/hide`, `/debug`.
- Must show in a menu when the user types `/` and autocomplete.
- "If no platform-level primitives exist to let apps define their own slash commands, ignore it for that platform." - Since Google Chat only supports static slash command registration via Console, we can document this or implement automated setup via Google Cloud API if the credentials permit. Discord supports dynamic registration and interaction.