# Development Log: 11_message_verbosity

## Ticket 1: Update Data Model
- Updated `src/shared/chats.ts` to add the optional `level` property to the `CommandLogMessage` interface. The property can be `'default' | 'debug' | 'verbose'`.
- Ran tests (`npm run format:check && npm run lint && npm run check && npm run test`) and confirmed that they all passed successfully.