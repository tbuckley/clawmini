# Questions for Routers Feature

## Q1
**Question**: How should user-defined routers be executed? For example, should the string in the `routers` array be treated as a shell command where the system passes the current state as a JSON string via `stdin` and expects the modified JSON object on `stdout`?
**Answer**: Yes, as a shell command executed in the workspace root. We may have some built-in ones (all prefixed with "@clawmini") that just map to internal functions.

## Q2
**Question**: When a router returns its output JSON, what specific properties should we support merging back into the state? Beyond `message`, `agent`, `session`, and `env`, are there others you'd like to support? (e.g., `abort` to cancel the message entirely, `reply` to send a response back immediately without invoking an agent, or `cwd` to change the agent's working directory?)
**Answer**: `reply` is interesting for the router to inject a message about what it did. `abort` could be useful but we'll hold off for now. We will stick to `message`, `agent`, `session`, `env`, and `reply`.

## Q3
**Question**: If a router returns a `reply` property, should that reply be inserted as an independent message in the chat timeline, or should it be appended to the current log message? If it is a separate message, what role should it have (`log`, `system`, etc.)?
**Answer**: Injected into the timeline before the agent's response. It should be an independent message with `role: 'log'` and `source: 'router'`.

## Q4
**Question**: Regarding the built-in routers `@clawmini/slash-new` and `@clawmini/slash-command`, should these be enabled by default for all chats if the user does not specify a `routers` array in `settings.json`, or should users have to explicitly opt-in to them?
**Answer**: Explicit opt in.

## Q5
**Question**: If a user-defined shell router returns a non-zero exit code or fails to output valid JSON, how should the system handle it? Should it silently fail and pass the original un-routed message to the agent, or should it log an error message to the user and halt the message processing entirely?
**Answer**: Log an error (debug-only?), but continue on.
