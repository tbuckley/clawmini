# Backing up your Clawmini workspace

Clawmini stores everything that matters about a workspace under
`.clawmini/`: chats, agents, environments, policies, and adapter
credentials. Losing that directory loses your chat history and forces
you to re-authenticate every adapter. This guide explains how to back
it up without leaking secrets.

## How to think about it

`.clawmini/` is a mix of three things, and they want different
treatment:

1. **Durable config** — `settings.json`, `policies.json`,
   `policy-scripts/`, `commands/`, `templates/`, per-chat metadata,
   per-agent settings, per-environment settings. Hand-written, slowly
   evolving, useful to review on github.com.
2. **Runtime state and history** — `chats/<id>/chat.jsonl`, logs,
   policy requests, file snapshots, command stdout/stderr captures.
   Mutable, sometimes large, sometimes contains private content (code
   you pasted, command output, files the agent looked at).
3. **Credentials** — `adapters/discord/config.json` (bot token),
   `adapters/google-chat/config.json` (OAuth client secret),
   `adapters/google-chat/state.json` (live OAuth refresh tokens).
   Sometimes also embedded in `agents/*/settings.json` or
   `environments/*/env.json` if you put API keys in their `env` block.

The first one wants version control. The second wants opaque
incremental snapshots. The third doesn't want to be in any backup that
will ever be cloned, shared, or pushed to a remote in plaintext.

A "private" git repo is **not** a credential vault: history is forever,
clones are unencrypted, and read access tends to widen over time
(collaborators, CI, leaked deploy keys). Treat it like a private Slack
channel — fine for config, wrong for tokens.

## The two tracks

Most users want both of these, for different reasons.

### Track 1 — Git for config (recommended)

Put `.clawmini/` itself under git, with a strict allow-list
`.gitignore` that ships only the safe-to-share config. Push to a
private remote. You get diffs, history, and a way to restore your
workspace shape on a new machine in one clone.

What's included: `settings.json`, `policies.json`, `policy-scripts/`,
`commands/`, `templates/`, chat metadata (not transcripts), agent
settings, environment settings, Discord adapter sync state.

What's excluded: chat transcripts, adapter credentials, OAuth tokens,
logs, tmp files, sockets. On restore you re-run `clawmini init` for
each adapter to rotate creds.

**Setup:**

`clawmini init` installs `.clawmini/.gitignore` automatically using the
allow-list template at
[`docs/backups/clawmini.gitignore`](../backups/clawmini.gitignore).
Workspaces created before this behaviour landed can retrofit it by
copying that template manually:

```sh
cp /path/to/clawmini/docs/backups/clawmini.gitignore .clawmini/.gitignore
```

Then push it to a private remote:

```sh
cd .clawmini
git init
git add .
git status   # *** review carefully before the first commit ***
git commit -m "Initial clawmini workspace backup"
git remote add origin <your-private-remote>
git push -u origin main
```

**Audit before your first push.** Two files are included by the
allow-list but can leak secrets if you've put API keys into them:

- `agents/*/settings.json` — check the `env` and `subagentEnv`
  blocks.
- `environments/*/env.json` — check the `env` block.

If you have inline secrets there, move them out (shell environment, a
separate uncommitted file, your OS keychain) before committing.

### Track 2 — Restic for everything else (optional but recommended)

If you want chat history and adapter credentials to survive a disk
failure, use a real backup tool. Restic, Borg, and Time Machine all
work; the walkthrough below uses restic because it's cross-platform,
encrypts at rest, dedupes between snapshots, and handles the unbounded
growth of `chat.jsonl` far better than git would.

The setup below backs up to **another local folder on the same
machine** every day. That protects you from `rm -rf`, agents going
sideways, and accidental git operations — but **not** from disk
failure or theft. Point the repo at an external drive or a remote
target (`b2:`, `sftp:`, `s3:`, …) when you want real off-device
durability; everything else in this section stays the same.

#### 1. Install restic

macOS:

```sh
brew install restic
```

Linux (pick whichever your distro uses):

```sh
sudo apt install restic            # Debian / Ubuntu
sudo dnf install restic            # Fedora / RHEL
sudo pacman -S restic              # Arch
```

#### 2. Pick a destination and a passphrase

Choose a folder *outside* your workspace — ideally on a different disk
or partition, but any local path works for a baseline.

```sh
export RESTIC_REPOSITORY="$HOME/Backups/clawmini-restic"
mkdir -p "$RESTIC_REPOSITORY"
```

Restic encrypts every snapshot with a passphrase. If you lose it, the
backup is unrecoverable — store it somewhere you'll still have after
your laptop dies (password manager, paper in a drawer, etc.). Save it
to a 0600-mode file so the scheduled job can read it without a prompt:

```sh
umask 077
printf '%s\n' 'your-long-passphrase-here' > "$HOME/.config/restic/clawmini.pw"
```

Initialize the repo (one time only):

```sh
restic init --password-file "$HOME/.config/restic/clawmini.pw"
```

#### 3. Write the backup script

Save this as `~/bin/clawmini-backup.sh` and `chmod +x` it. Edit
`WORKSPACE` to point at your workspace.

```sh
#!/usr/bin/env bash
set -euo pipefail

WORKSPACE="$HOME/path/to/workspace"
export RESTIC_REPOSITORY="$HOME/Backups/clawmini-restic"
export RESTIC_PASSWORD_FILE="$HOME/.config/restic/clawmini.pw"

RESTIC_BIN="$(command -v restic)"

"$RESTIC_BIN" backup "$WORKSPACE/.clawmini" \
  --tag clawmini \
  --exclude '*.sock' \
  --exclude '*.tmp' \
  --exclude '.clawmini/tmp/snapshots/*'

"$RESTIC_BIN" forget \
  --tag clawmini \
  --keep-daily 30 --keep-weekly 8 --keep-monthly 12 \
  --prune
```

The retention policy keeps the last 30 daily snapshots, 8 weekly, and
12 monthly — roughly a year of history with a long tail of dailies for
recent recovery. `--prune` reclaims the space from forgotten snapshots
in the same run.

Verify the script works manually before scheduling it:

```sh
~/bin/clawmini-backup.sh
restic snapshots                   # should list a snapshot
```

#### 4. Schedule it daily

##### macOS — launchd

Save this as `~/Library/LaunchAgents/com.clawmini.backup.plist`,
replacing `YOURUSER` with your home-directory username:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key><string>com.clawmini.backup</string>
    <key>ProgramArguments</key>
    <array>
      <string>/Users/YOURUSER/bin/clawmini-backup.sh</string>
    </array>
    <key>StartCalendarInterval</key>
    <dict>
      <key>Hour</key><integer>3</integer>
      <key>Minute</key><integer>15</integer>
    </dict>
    <key>StandardOutPath</key>
    <string>/Users/YOURUSER/Library/Logs/clawmini-backup.log</string>
    <key>StandardErrorPath</key>
    <string>/Users/YOURUSER/Library/Logs/clawmini-backup.log</string>
  </dict>
</plist>
```

Load it and verify:

```sh
launchctl load ~/Library/LaunchAgents/com.clawmini.backup.plist
launchctl list | grep clawmini       # confirms it's registered
launchctl start com.clawmini.backup   # run once now
tail ~/Library/Logs/clawmini-backup.log
```

To remove it later: `launchctl unload ~/Library/LaunchAgents/com.clawmini.backup.plist`.

If your laptop is asleep at the scheduled time, launchd runs the job
on the next wake. Good enough for a daily backup.

##### Linux — systemd timer

Create the service unit at `~/.config/systemd/user/clawmini-backup.service`:

```ini
[Unit]
Description=Clawmini workspace restic backup

[Service]
Type=oneshot
ExecStart=%h/bin/clawmini-backup.sh
Nice=10
IOSchedulingClass=idle
```

Create the timer at `~/.config/systemd/user/clawmini-backup.timer`:

```ini
[Unit]
Description=Daily Clawmini restic backup

[Timer]
OnCalendar=*-*-* 03:15:00
Persistent=true
RandomizedDelaySec=15m

[Install]
WantedBy=timers.target
```

`Persistent=true` makes systemd run a missed backup on next boot
(important for laptops). Enable and start:

```sh
systemctl --user daemon-reload
systemctl --user enable --now clawmini-backup.timer
systemctl --user list-timers clawmini-backup.timer
```

To run a backup immediately:
`systemctl --user start clawmini-backup.service`. Logs:
`journalctl --user -u clawmini-backup.service`.

If you want the timer to fire while you're logged out, run
`loginctl enable-linger $USER` once.

If you don't have systemd (or prefer cron), the equivalent crontab
entry is:

```cron
15 3 * * * /home/YOURUSER/bin/clawmini-backup.sh >> /home/YOURUSER/.local/share/clawmini-backup.log 2>&1
```

#### 5. Restore

```sh
restic snapshots                                # list backups
restic restore latest --target /tmp/restore     # pull latest into /tmp/restore
```

The restored tree contains a `.clawmini/` directory you can copy back
into a fresh workspace.

If you don't want a separate tool, Time Machine on macOS or your
distro's equivalent covers the same use case at coarser granularity;
just make sure `.clawmini/` is included.

## Common questions

**"Can I just push the whole `.clawmini/` to a private repo?"** Don't.
Your Discord bot token, Google OAuth client secret, and live OAuth
refresh tokens would go to the remote in plaintext, in permanent
history. Rotation (not deletion) is the only fix once that happens.

**"What about `git-crypt` so I can keep one repo?"** It works but adds
a key-management problem (lose the key, lose the backup) and easy
misconfigurations (smudge/clean filters silently fail). Worth it only
if you specifically want one combined repo. Otherwise Track 1 + Track 2
separates concerns more cleanly.

**"Will Track 1 let me move my workspace to a new laptop?"** Yes for
config; no for credentials and chat history. After cloning, you re-run
`clawmini init` for each adapter (which rotates the bot token / OAuth
grant — generally what you want when moving machines anyway). Track 2
restores the rest.

**"What if I add a new adapter or some new file appears under
`.clawmini/`?"** The `.gitignore` is allow-list, so new files default
to *not* tracked. Inspect `git status --ignored`, decide whether the
new file is safe, and add an explicit `!path/to/file` if it is.

**"Can I trust `agents/*/settings.json` to be safe?"** Mostly yes —
it's template-derived config — but the `env` block is a free-form map
where users sometimes drop API keys. Audit before each commit, or
adopt a habit of keeping secrets out of that file entirely.

## Reference

- Allow-list `.gitignore` template:
  [`docs/backups/clawmini.gitignore`](../backups/clawmini.gitignore)
- Full sensitivity inventory and option analysis:
  [`docs/backups/SPEC.md`](../backups/SPEC.md)
