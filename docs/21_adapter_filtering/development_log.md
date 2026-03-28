# Adapter Filtering Development Log

## Progress
- Started working on Ticket 1: Update Configuration Schemas.
- Updated `DiscordConfigSchema` and `GoogleChatConfigSchema` with `messages` property (`z.record(z.string(), z.boolean()).optional()`).
- Updated unit tests for configuration to test parsing of `messages` property.
- Ran `npm run validate` which passed successfully.
- Completed Ticket 1.