# PRD: Clawmini Cron Feature

## Vision

The `clawmini cron` feature introduces automated, scheduled message generation and processing within Clawmini chats. This allows users to set up periodic updates, scheduled reminders, or delayed executions for their agents without having to manually trigger them. The functionality seamlessly integrates into the existing chat-based architecture, maintaining the source of truth in per-chat configuration files.

## Product/Market Background

Users often need their agents to perform routine tasks autonomously. Examples include generating a daily summary, pinging a remote API every hour, or sending a reminder at a specific time. Currently, Clawmini relies on manual message input. Adding a robust scheduling system elevates Clawmini from a reactive tool to a proactive agent runner, allowing agents to maintain their own routines.

## Use Cases

1. **Daily Summaries:** A user wants their "summarizer" agent to fetch and summarize news articles every day at 8:00 AM.
2. **Periodic Checks:** A user wants an agent to check a system's status every 15 minutes (`--every 15m`).
3. **Scheduled Reminders:** A user wants to schedule a one-off reminder to be sent tomorrow at 2:00 PM (`--at "2026-03-01T14:00:00Z"`).
4. **Isolated Tasks:** A user wants a recurring job to run in an entirely isolated session every time it triggers so previous context doesn't interfere (`--session type=new`).

## Requirements

### Data Model & Persistence

1. **Storage:** Cron jobs are stored within the per-chat `settings.json` file. This file acts as the ultimate source of truth.
2. **Job Definition:** A cron job configuration must include:
   - `id`: A unique string name for the job (valid ID format similar to agents/sessions).
   - `message`: The message content to send (defaults to an empty string `""`).
   - `reply`: An immediate reply to append before execution (optional).
   - `agentId`: The ID of the agent to use (optional).
   - `env`: Environment variables specific to the execution (optional).
   - `session`: Session configuration, e.g., `{ type: "new" }` to indicate a new session should be used each time (optional).
   - `schedule`: The scheduling criteria. It must support one of:
     - `cron`: A standard crontab expression (e.g., `* * * * *`).
     - `every`: A duration string (e.g., `20m`, `4h`).
     - `at`: An ISO-8601 UTC date-time string (e.g., `2026-02-28T12:00:00Z`).
3. **One-Off Jobs:** Jobs defined with `--at` are single-execution. After they run successfully, they should be automatically removed from the chat's `settings.json` file.

### CLI Interface

A new `clawmini cron` command group will be added:

1. **`clawmini cron list`**
   - Lists all configured cron jobs for the current (or specified) chat.
2. **`clawmini cron add <name>`**
   - Adds a new cron job.
   - **Options:**
     - `--message <text>`: The message to send. Default `""`.
     - `--reply <text>`: An immediate reply to append.
     - `--at <iso-time>`: Execute once at this UTC time.
     - `--every <duration>`: Execute repeatedly at this interval (e.g., `20m`, `4h`).
     - `--cron <expression>`: Execute according to the crontab expression.
     - `--agent <agentid>`: Agent to use.
     - `--env <KEY=value>`: Set environment variables (can be used multiple times).
     - `--session <KEY=value>`: Session configuration (e.g. `type=new` to use a new session ID for each execution).
     - `--chat <chatid>`: Specify the chat (defaults to the active chat).
3. **`clawmini cron delete <name>`**
   - Deletes the cron job with the given name from the chat.

### Daemon Execution & Scheduling

1. **Scheduler Initialization:**
   - The daemon must load jobs from all chat directories upon startup. This involves scanning the chats directory and parsing `settings.json` files to initialize the internal scheduler.
   - *Alternative consideration:* To avoid reading all files if the number of chats grows large, an index or file-watcher (`chokidar`) could be used, but scanning on startup and combining with file-watching is the most robust way to ensure the chat files remain the absolute source of truth.
2. **Execution Context:**
   - Cron-triggered messages **bypass all routers**. The daemon directly prepares the `RouterState` equivalent using the job's defined properties.
   - The message is executed similarly to a regular user message but without the router pipeline step.
3. **Session Handling:**
   - If `session.type` is `"new"`, the daemon generates a new `sessionId` for the execution but *does not* write this `sessionId` back to the chat's persistent `settings.json` under `sessions[agentId]`.
4. **Scheduling Library:**
   - A robust scheduling library such as `node-schedule` or `node-cron` will be added to the daemon's dependencies to handle crontab parsing and time-based triggering.

### Web UI

1. **Placement:** A new settings page will be introduced. It will be accessible via a 3-dot menu in the chat view (e.g., top-right corner) which navigates to a `../settings` sub-route for that chat.
2. **Functionality:**
   - View a list of all active cron jobs for the chat.
   - Add new cron jobs with form fields supporting the CLI options (`at`, `every`, `cron`, `message`, etc.).
   - Delete existing cron jobs.
   - The Web UI will communicate with the daemon via new TRPC endpoints (e.g., `addCronJob`, `deleteCronJob`, `listCronJobs`).

## Privacy & Security Concerns

1. **Execution Privileges:** Cron jobs execute arbitrary agent commands on a schedule. This inherits the security implications of the underlying agents. There is no privilege escalation, as the daemon runs under the user's standard permissions.
2. **Environment Variables:** Jobs can store environment variables. These should be treated with the same sensitivity as existing agent configurations (they will sit in plain text inside `settings.json`).
3. **Resource Exhaustion:** Care should be taken to ensure extremely frequent jobs (e.g., `--every 1s` or a poor cron expression) do not inadvertently lock up the system. The CLI may optionally warn or prevent sub-minute scheduling unless explicitly desired, though `node-cron` generally handles down to seconds/minutes.

## Next Steps

Once this PRD is approved, development will commence by:
1. Defining the `settings.json` types for cron jobs.
2. Integrating a scheduling library into the daemon.
3. Creating the CLI commands.
4. Implementing the daemon scheduling, execution logic, and TRPC endpoints.
5. Building the Web UI settings page and integration.