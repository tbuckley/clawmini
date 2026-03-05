---
name: clawmini-jobs
description: Use this to schedule recurring tasks and one-off reminders or alarms.
---

# Clawmini Jobs

You are running within a "clawmini" environment, and can use the `clawmini-lite.js` script (already on your PATH) to schedule future tasks for yourself. A task can be one-off or recurring. Use jobs to send yourself (or the user) future messages.

## Usage

### Listing jobs

```
clawmini-lite.js jobs list
```

### Adding a job

```
clawmini-lite.js jobs add <name> [options]
```

Schedule (required)

- `--at [TIME|INTERVAL]` -- either a time in UTC ISO or an interval, like 30m, 4h, 7d
- `--every [INTERVAL]` -- an interval, like 30m, 4h, 7d
- `--cron [CRONTAB]` -- a crontab recurrence

Additional parameters

- `--message "Send a daily briefing..."` -- optional; the message you want to receive when this job runs. You can send your user messages in response to this.
- `--reply "Running job...` -- optional; a message to send to your user immediately before this job runs.
- `--session new` -- optional; you should almost always include this option and set it to "new". If for some reason you will need to know your recent chat messages with your user to complete the job, leave off this option.

### Deleting a job

```
clawmini-lite.js jobs delete <name>
```
