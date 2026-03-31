# Timestamp Prefix Tickets

## Step 1: Update Configuration Schema
- **Description**: Add the `timestampPrefix` setting to the global configuration schema.
- **Actions**:
  - Update `src/shared/config.ts` to include `timestampPrefix: z.boolean().default(true).optional()` in the `SettingsSchema`.
- **Verification**: 
  - Ensure type checks pass.
  - Run the `npm run validate` command to verify all formatting, linting, and existing tests pass.
- **Status**: Completed

## Step 2: Inject Timestamp Prefix in Agent Request Payload
- **Description**: Dynamically inject the timestamp prefix into user messages before sending them to the LLM provider.
- **Actions**:
  - Locate the agent loop/provider payload construction logic (where conversation history is passed to the LLM).
  - Retrieve the current settings using `getSettings()`.
  - If `timestampPrefix` is true, iterate over the messages.
  - For messages where `role === 'user'` or `displayRole === 'user'`, prepend `[YYYY-MM-DD HH:MM Z] ` (using the local system time) to the `content`.
  - Ensure this injection happens *only* for the payload sent to the LLM, without permanently mutating the original stored chat history in the database.
- **Verification**:
  - Write or update unit tests to verify that the prefix is correctly formatted and applied only when the setting is enabled.
  - Verify that the original stored message content remains untouched.
  - Run the `npm run validate` command to ensure all checks pass.
- **Status**: Completed
