# Product Requirements Document: Timestamp Prefix for Agent Context

## Vision
Give AI agents an awareness of the passage of time during conversations. By providing timestamps on user and system messages, agents will have necessary temporal context, enabling them to understand temporal references like "yesterday," "an hour ago," or "this morning."

## Product / Market Background
Currently, AI agents operate in a stateless environment where context is purely driven by the sequence of messages provided in the prompt. If a user sends a message, leaves the app, and returns a day later to send another message, the agent has no indication that time has passed. This leads to disjointed conversations where the agent assumes all interactions are happening in immediate succession. Adding explicit timestamps to incoming messages gives the LLM built-in context about real-world pacing.

## Use Cases
1. **Long-Running Sessions**: A user is interacting with an agent continuously over several days. The agent needs to understand that a log from yesterday is not immediately relevant to a crash happening right now.
2. **Temporal Grounding**: A user says "can you remind me what we did this morning?" or "what changed since yesterday?". The agent can use the timestamp prefixes to accurately identify which messages correspond to "this morning" or "yesterday."
3. **Opting Out**: A user who is running specialized integration tests or deterministic scripted workflows may wish to disable timestamps to prevent variation in the agent prompt.

## Requirements

### Configuration
1. Introduce a new setting `timestampPrefix` in the global `SettingsSchema` (`src/shared/config.ts`).
2. The `timestampPrefix` property must be typed as an optional boolean (`z.boolean().optional()`).
3. The default value for `timestampPrefix` when resolving settings should be `true`.
4. Users can manually disable it by setting `"timestampPrefix": false` in their `.clawmini/settings.json`.

### Core Behavior
1. Before passing conversation history to the underlying LLM provider, the system must evaluate each message.
2. If the message has `role === 'user'` or `displayRole === 'user'` (which includes both user interactions and system directives acting as the user), a timestamp string should be prepended to the message's `content`.
3. The format of the prefix should be `[YYYY-MM-DD HH:MM Z] ` (where Z is the timezone offset/abbreviation, or localized equivalent depending on standard Javascript formatting).
4. The timestamp must use the user's local system time (the device executing the daemon).
5. The original stored chat history and message database shouldn't necessarily include the prefix to avoid permanent mutations of stored messages. The prefix should be injected dynamically right before constructing the AI provider request payload.

### Future Considerations
While implemented as a boolean initially, the architecture should be kept simple to allow migrating `timestampPrefix` to accept a string formatting template in the future if requested by users.

## Concerns

- **Privacy & Security**: The timestamp uses local system time. Since the tool operates entirely locally on the user's machine, there is no leakage of timezone information to centralized servers unless the user deliberately shares chat logs. No significant security concerns.
- **Context Window / Token Usage**: Adding a short prefix (e.g., `[2026-03-30 09:07 EST] `) adds ~6-8 tokens per user message. Over extremely long conversations, this accumulates slightly, but the context improvement heavily outweighs the nominal token cost.
- **Accessibility**: This change affects internal AI context and invisible metadata. Visual UI presentation of the messages to the user should remain unaffected. No accessibility impact.
