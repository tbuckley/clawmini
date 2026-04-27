# `.clawmini` Backup — what's safe, what's not, and how to do it

## Goal

Decide what under a workspace's `.clawmini/` directory can safely be pushed
to a private git remote (or any external backup target) for disaster
recovery, and what must stay on the local machine.

"Private repo" is not the same as "secret store". Even a private GitHub
repo:

- Stores everything in plaintext on Anthropic's, GitHub's, and any
  collaborator's disks.
- Keeps a permanent history — once a token is committed, rotation is the
  only real remediation.
- Gets cloned to CI, other workstations, and any future tooling you wire
  up. Each clone is a copy of every secret it contains.
- Is reachable by anyone with read access to the repo (org admins, future
  teammates, leaked SSH keys, stolen laptops).

So the bar for "safe to back up" is: would I be comfortable if this file
were posted in a private channel that 5 people will eventually read? Not
"is the repo private right now?".

---

## Inventory of `.clawmini/`

Sensitivity ratings: **LOW** = config/metadata, **MED** = may contain
secrets depending on user, **HIGH** = routinely contains secrets or
private content, **CRIT** = always contains live credentials.

### Stable, user-authored config

| Path | Sensitivity | Notes |
| --- | --- | --- |
| `settings.json` | LOW | Default chat id, environment-to-path map. |
| `policies.json` | LOW | Policy command/args definitions. |
| `policy-scripts/*.js` | LOW–MED | User code; treat like any source file. |
| `commands/*.{md,txt}` | LOW–MED | Slash-command text. May contain prompts/snippets. |
| `templates/*` | LOW–MED | Mirrors built-in templates; rarely sensitive. |
| `chats/<id>/settings.json` | LOW | Per-chat metadata. |
| `agents/<id>/installed-files.json` | LOW | SHA manifest only. |

### Per-agent / per-environment config (mostly safe, leaks via `env`)

| Path | Sensitivity | Notes |
| --- | --- | --- |
| `agents/<id>/settings.json` | MED | `env` and `subagentEnv` may hold API keys. |
| `agents/<id>/sessions/<sid>/settings.json` | MED | Same shape, per session. |
| `environments/<name>/env.json` | MED | `env` block may hold secrets; `init` script may reference them. |
| `environments/<name>/*` | MED | Whatever the user dropped in. |

### Conversation + execution history (private content, sometimes secrets)

| Path | Sensitivity | Notes |
| --- | --- | --- |
| `chats/<id>/chat.jsonl` | HIGH | Full transcript: user prompts, model output, tool I/O, command stdout/stderr, file contents pasted in. Routinely contains code, internal docs, occasionally credentials echoed by a misbehaving script. Append-only, can be very large. |

### Adapter config + state (credential central)

| Path | Sensitivity | Notes |
| --- | --- | --- |
| `adapters/discord/config.json` | **CRIT** | `botToken` is a live Discord bot token (required field). |
| `adapters/discord/state.json` | LOW | Sync cursors + channel→chat map. No secrets. |
| `adapters/google-chat/config.json` | **CRIT** | `oauthClientId` / `oauthClientSecret` for Drive. |
| `adapters/google-chat/state.json` | **CRIT** | `oauthTokens` — live refresh + access tokens. |

### Runtime / ephemeral / IPC

| Path | Sensitivity | Notes |
| --- | --- | --- |
| `daemon.sock` (a.k.a. `server.sock` in older builds) | n/a | Unix socket — not a real file, can't be copied. Exclude. |
| `daemon.log` | MED | Stderr from the daemon. Paths, errors, sometimes argv. |
| `logs/*.log` (`web.log`, `adapter-*.log`) | MED | Same shape, per service. |
| `supervisor.pid` | LOW | `<pid>:<startTime>`. Worthless on another machine. |
| `tmp/requests/<rid>.json` | HIGH | Pending policy requests, including `executionResult.{stdout,stderr}`. |
| `tmp/snapshots/*` | HIGH | Up-to-5MB copies of files a policy is about to touch. |
| `tmp/discord/*`, `tmp/google-chat/*` | HIGH | Downloaded chat attachments. |
| `tmp/<agentId>/stdout-<rid>.txt`, `stderr-<rid>.txt` | HIGH | Truncated command output (>500 chars). |
| `*.<pid>.<hex>.tmp` | n/a | Atomic-write scratch files. Exclude. |

### "There may be more"

The user explicitly flagged this. Things that are likely or known to
appear over time and aren't enumerated above:

- New adapter directories as new adapters land (each tends to follow the
  `config.json` + `state.json` pattern — assume CRIT until proven LOW).
- Hooks / skills installed under `agents/<id>/` by templates.
- Future cache directories.

The backup policy below is therefore **allow-list**, not deny-list — new
unknown files default to *not backed up* until a human looks at them.

---

## Options considered

### A. Back up `.clawmini/` wholesale to a private git repo

Easiest. One `git init` inside `.clawmini`, push to a private remote,
done.

- **Pro:** zero ongoing thought; everything recovers.
- **Con:** ships every Discord bot token, every OAuth refresh token, and
  every chat transcript to the remote in plaintext, forever. Any future
  collaborator, CI runner, or leaked deploy key gets all of it. Token
  rotation requires git-history rewriting.
- **Verdict:** rejected. The credential exposure is not acceptable even
  for a single-user "private" repo.

### B. Wholesale backup with `git-crypt` / `git-secret` / `age` for sensitive files

Same as A, but adapter configs, state, and chat history are encrypted at
rest in the repo with a key kept locally.

- **Pro:** one repo covers everything; secrets are encrypted; you can
  share the repo without sharing the key.
- **Con:** adds a key-management problem (you now must back up the key
  separately, or losing the laptop also loses the backup). `git-crypt`
  in particular smudge/cleans on every checkout — easy to misconfigure
  and accidentally commit plaintext. Encrypting an append-only JSONL
  blows up diffs.
- **Verdict:** viable, but heavier than the user's needs and trades one
  problem (secret leakage) for another (key custody). Worth it only if
  full chat history backup is a hard requirement.

### C. Allow-list backup of low-risk config only

A `.gitignore` inside `.clawmini/` that excludes by default and includes
a known-safe set: `settings.json`, `policies.json`, `policy-scripts/`,
`commands/`, `templates/`, `chats/*/settings.json`,
`agents/*/settings.json`, `agents/*/installed-files.json`,
`environments/*/env.json`, `adapters/*/state.json` *except* google-chat.

Per-agent/env settings sometimes contain `env` API keys — still risky.
This option drops them or asks the user to inline-strip them.

- **Pro:** simple, no encryption, no key. Restoring on a new machine
  gives back the *shape* of the workspace (chats, agents, environments,
  policies) immediately.
- **Con:** chat transcripts are not backed up. Adapter credentials are
  not backed up — you have to re-do `clawmini init` for each adapter on
  restore. `agents/*/settings.json` may still leak if the user put keys
  in `env`.
- **Verdict:** strong default. Matches "back up the things that are a
  pain to recreate, accept that secrets get rotated."

### D. Allow-list config (option C) **plus** encrypted bundle for chats and adapters

Option C handles the durable config in cleartext. Sensitive content goes
into an encrypted tarball committed alongside.

- **Pro:** chats and adapter creds *are* recoverable; the encrypted
  blob keeps them out of plain git history.
- **Con:** key management again; the tar grows; restore is a two-step.
- **Verdict:** the right answer if the user wants real DR, not just
  config preservation.

### E. Don't use git at all — use a backup tool (restic, borg, time machine)

`restic` to a private S3 bucket / B2 / SSH host with a passphrase, or
just include `.clawmini` in Time Machine.

- **Pro:** purpose-built for this; encryption, dedup, point-in-time
  snapshots, prune. Handles binary growth (chat.jsonl) far better than
  git. No accidental plaintext credentials in a permanent history.
- **Con:** not a git repo, so no easy diffing or merging across
  machines. You don't get the "view my settings on github.com" niceness.
- **Verdict:** technically the cleanest answer for the "avoid data loss"
  framing the user mentioned at the end. Worth recommending alongside.

---

## Recommendation

Two-track approach. Pick based on what the user actually wants out of
the backup.

### Track 1 — config-only git backup (recommended default)

Use **Option C** for the version-controlled, shareable, "I want to see
my workspace settings on a new laptop" backup.

Concretely: put a `.gitignore` at the root of `.clawmini/` that opts
out of everything and re-opts-in only the safe set. Suggested contents:

```gitignore
# default: ignore everything
*

# re-include known-safe config
!.gitignore
!settings.json
!policies.json
!policy-scripts/
!policy-scripts/**
!commands/
!commands/**
!templates/
!templates/**

# chat *metadata* only — not transcripts
!chats/
chats/*
!chats/*/
!chats/*/settings.json

# agents: settings + manifest, no sessions, no tmp
!agents/
agents/*
!agents/*/
!agents/*/settings.json
!agents/*/installed-files.json

# environments: env.json only
!environments/
environments/*
!environments/*/
!environments/*/env.json

# adapters: state only, and only for adapters known not to hold creds
# (discord state is safe; google-chat state holds OAuth tokens — exclude)
!adapters/
adapters/*
!adapters/discord/
adapters/discord/*
!adapters/discord/state.json

# everything else stays ignored: chat.jsonl, tmp/, logs/, daemon.log,
# daemon.sock, supervisor.pid, *.tmp, adapters/*/config.json,
# adapters/google-chat/state.json, agents/*/sessions/, agents/*/tmp/
```

Caveats the user should accept up front:

1. **Re-check `agents/*/settings.json` and `environments/*/env.json`
   before the first push** — if the user has put API keys into `env`,
   they'll go to the remote. Either move them out (e.g. into shell env
   or a separate uncommitted file) or downgrade this track to manual
   review.
2. **Adapter credentials are not backed up.** On a new machine, re-run
   `clawmini init` for each adapter. This is a feature, not a bug:
   token rotation is the standard fix for "laptop lost".
3. **Chat history is not backed up.** If that's a problem, add Track 2.

### Track 2 — full disaster-recovery backup (optional, for chats + creds)

Use **Option E** (`restic` or similar) for the "I don't want to lose my
chat history if my disk dies" backup. Point it at the entire
`.clawmini/` directory excluding only `daemon.sock` and `*.tmp`
scratch files. The tool handles encryption, incremental snapshots, and
the inevitable size growth of `chat.jsonl`.

Rough sketch:

```sh
restic -r <repo> backup \
  ~/path/to/workspace/.clawmini \
  --exclude '*.sock' --exclude '*.tmp' \
  --exclude '.clawmini/tmp/snapshots/*'   # optional: skip large file snapshots
```

This is the right tool for opaque, mutable, occasionally-sensitive
runtime state. Don't try to make git do it.

### What about Option D (encrypted bundle in the same git repo)?

Only worth the complexity if the user specifically wants *one* repo
that contains both the config and the sensitive bits. Otherwise Track 1
+ Track 2 separates concerns cleanly: git for the human-readable
config, restic for the runtime data.

---

## Summary table — what goes where

| Path | Track 1 (git) | Track 2 (restic) |
| --- | --- | --- |
| `settings.json`, `policies.json` | ✅ | ✅ |
| `policy-scripts/`, `commands/`, `templates/` | ✅ | ✅ |
| `chats/*/settings.json` | ✅ | ✅ |
| `chats/*/chat.jsonl` | ❌ | ✅ |
| `agents/*/settings.json` (review for `env` secrets!) | ⚠️ | ✅ |
| `agents/*/installed-files.json` | ✅ | ✅ |
| `agents/*/sessions/*`, `agents/*/tmp/*` | ❌ | ✅ |
| `environments/*/env.json` (review for `env` secrets!) | ⚠️ | ✅ |
| `adapters/discord/config.json` | ❌ | ✅ |
| `adapters/discord/state.json` | ✅ | ✅ |
| `adapters/google-chat/config.json` | ❌ | ✅ |
| `adapters/google-chat/state.json` | ❌ | ✅ |
| `daemon.log`, `logs/*.log` | ❌ | optional |
| `tmp/**`, `*.tmp`, `*.sock`, `supervisor.pid` | ❌ | ❌ |

⚠️ = include only after auditing the file for inline secrets.
