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
work; the example below uses restic because it's cross-platform and
encrypts at rest.

```sh
# one-time setup
restic init -r <your-restic-repo>   # e.g. b2:bucket:path or sftp:host:path

# back up
restic -r <your-restic-repo> backup ~/path/to/workspace/.clawmini \
  --exclude '*.sock' \
  --exclude '*.tmp' \
  --exclude '.clawmini/tmp/snapshots/*'    # optional, can be large
```

Restic encrypts with a passphrase you control, dedupes between
snapshots, and handles the unbounded growth of `chat.jsonl` far better
than git would. Schedule it (cron, launchd, systemd timer) and you're
done.

If you don't want a separate tool, Time Machine on macOS or your
distro's equivalent covers this case; just make sure `.clawmini/` is
included.

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
