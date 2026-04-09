# Timestamp Prefix Settings

## Current Implementation

- We have a global `Settings` type defined in `src/shared/config.ts` through `SettingsSchema`.
- This maps to `.clawmini/settings.json`.
- When users send a message via the CLI or web interface, it's routed through `sendMessage` TRPC procedure.
- The daemon (agent loop) builds the payload and forwards to Gemini via `@google/genai` or similar.

## Changes Required

- Add `timestampPrefix: z.boolean().default(true).optional()` to `SettingsSchema` in `src/shared/config.ts`.
- In the agent loop or where the message is appended, read the setting from `getSettings()`.
- If `timestampPrefix` is true, prefix `content` of the message from the user with `[YYYY-MM-DD HH:MM Z] ` based on the user's or server's current timezone.

## Questions

1. Should the timestamp prefix apply only to the first message of a prompt, or every subsequent message?
2. Should the timezone be UTC or the local server's timezone? (Defaulting to local server timezone would align with `new Date().toLocaleString()`).
3. Does it only prefix "user" messages or also system prompts or tool responses?
