# Questions

1. **Scheduling Library**: Is there a preferred npm library for parsing and scheduling cron expressions (e.g., `cron`, `node-cron`, `node-schedule`) or should we add one to the daemon's dependencies?
2. **Daemon Initialization**: To ensure the daemon schedules the cron jobs, should the daemon scan all chat directories on startup to load their settings, or is there another preferred initialization process for loading all chats into memory?
3. **Web UI Placement**: In the Web UI, where exactly should the cron job management interface be located? (e.g., a tab inside the chat view, a dialog modal from a settings button, or a dedicated sidebar section?)
4. **Session State**: When a user creates a cron job with `--new-session`, does that mean the message executes with a brand new `sessionId` every time, and that session ID is NOT saved to the chat's default session state for that agent?
5. **Time Formats**: Are there specific formats you expect for `--at` (e.g., ISO-8601, `HH:MM`) and `--every` (e.g., "5m", "1h")? Should we use a specific parsing library for these (like `ms`), or stick to standard standard string parsing?

## Answers

1. **Scheduling Library**: No preference, choose whatever is most appropriate (e.g. `cron` or `node-cron` or `node-schedule`).
2. **Daemon Initialization**: Okay with scanning on startup, but should consider if there is another alternative. The most important is that the chat files are the source of truth.
3. **Web UI Placement**: Add a 3-dot menu to the chat view that takes the user to a `../settings` sub-url for the chat where they can view the jobs.
4. **Session State**: Yes, brand new session each time and it is not saved.
5. **Time Formats**: Should support both UTC ISO for absolute times and "20m" / "4h" / etc for durations from now.