# Development Log

## 2026-02-27 - Routers Feature
- **Ticket 1 Completed:** Updated `src/shared/config.ts` to add the `routers` property (an optional array of strings) to both `SettingsSchema` and `ChatSettingsSchema`. Ran the required formatting, linting, and testing checks, which all passed successfully.
- **Ticket 2 Completed:** Updated `CommandLogMessage` schema in `src/shared/chats.ts` to support the optional `source?: 'router'` property. Added a unit test case for it in `src/shared/chats.test.ts`. Ran all checks and they passed successfully.
