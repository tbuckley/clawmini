# Unified startup for clawmini

**Status:** brainstorm. Not a decided plan — exploring the design space so we can pick a direction.

## Problem

Starting clawmini today requires three-to-four separate commands:

```bash
clawmini down && clawmini up            # restart daemon
clawmini-adapter-discord                # adapter (foreground)
clawmini-adapter-google-chat            # another adapter (foreground)
clawmini web                            # web UI (foreground)
```

Each runs in its own terminal. If you're not tailing terminals, logs end up in `.clawmini/daemon.log` (for the backgrounded daemon) and nowhere for adapters (they go to whatever terminal you launched them in). Finding what went wrong means hopping between terminals or SSH sessions.

Three things feel wrong:

1. **Too many commands** to start a working setup.
2. **Logs are hard to watch** — daemon logs go to a file you have to know about; adapter logs are scattered across terminals.
3. **No clean upgrade path.** You can't currently tell a running agent "/update yourself" — there's no orchestrator that knows how to stop-upgrade-restart the full constellation.

The user's goals (in priority order):
1. One command to start everything, with logs visible by default.
2. Still be able to run detached / in the background when wanted.
3. Future: expose an "update" operation to the agent that safely rolls over the whole stack after an `npm install -g clawmini@latest`.

## Design space

The interesting axes:

- **Process model:** single process (everything in one Node) vs. supervised children (one parent spawns daemon + adapters + web) vs. status-quo (each its own top-level process).
- **Log model:** stdout in foreground vs. log files + `clawmini logs -f` command vs. both.
- **Config for "what to start":** CLI flags (`clawmini run --discord --web`) vs. settings-driven (enabled services listed in `.clawmini/settings.json`) vs. auto-detect (adapter configured → start it).
- **Backgrounding:** built-in `--detach` flag vs. rely on `nohup` / `screen` / system service manager vs. write a launchd/systemd template.

These compose. Below I sketch four directions and note what each gets right / wrong.

## Option A — `clawmini serve` (supervisor command)

A new top-level command that becomes the one-and-only launcher:

```bash
clawmini serve                       # foreground, all enabled services, interleaved logs
clawmini serve --detach              # daemonize, logs to .clawmini/logs/*.log
clawmini serve --only daemon,web     # subset
```

`serve` spawns a parent process that:
- Runs the daemon in-process (reuse `initDaemon()` directly — no subprocess needed).
- Spawns `adapter-discord` / `adapter-google-chat` / `web` as child processes if configured/enabled.
- Multiplexes their stdio into prefixed output lines (`[daemon] listening on ...`, `[discord] ready`, `[web] http://localhost:8080`).
- On Ctrl-C, sends SIGTERM to children, calls daemon `shutdown()`, waits for clean exit.
- On child crash, restarts with backoff (optional — or just log + exit).

**How do we know which services to start?** Auto-detect based on what's configured in `.clawmini/`:
- Daemon: always.
- Web: always (or opt-out flag — it's basically free).
- `adapter-discord`: if `.clawmini/adapters/discord/config.json` exists.
- `adapter-google-chat`: if `.clawmini/adapters/google-chat/config.json` exists.

Optional override via `--only`/`--exclude` flags.

**Detach mode (`--detach`):** fork a supervisor into the background, open log files at `.clawmini/logs/{daemon,discord,google-chat,web}.log`, exit the foreground shell. `clawmini logs [-f] [--service <n>]` tails them.

**Pros:**
- One command. Matches mental model of `docker compose up`, `foreman start`, `overmind start`.
- Logs are multiplexed and visible by default (addresses goal #1).
- Backgrounding preserved via `--detach` (addresses goal #2).
- Sets up the infrastructure needed for `/update`: there's now a single parent to SIGTERM, wait for, re-exec after upgrade (addresses goal #3).
- Adapters don't need to change their main logic — they just get spawned by a different process.

**Cons:**
- `clawmini up` / `clawmini down` semantics get murky. Does `clawmini up` still work (daemon-only)? Do we deprecate it? Keep it as an alias?
- Child-process log multiplexing is annoying to get right (line buffering, ANSI colors, interleaving).
- Adapters become coupled to the supervisor's lifecycle — less flexible for people who want to run the discord adapter on a different host. (Probably fine: if you need that, you can still `npx clawmini-adapter-discord` manually.)

## Option B — Teach the daemon to supervise adapters

Same end result, different split: the daemon itself gains a service manager. On `clawmini up`, the daemon reads `.clawmini/settings.json`, sees which adapters are enabled, spawns them as children. On `clawmini down`, it kills them.

```json
// .clawmini/settings.json
{
  "services": {
    "web": { "enabled": true, "port": 8080 },
    "adapter-discord": { "enabled": true },
    "adapter-google-chat": { "enabled": false }
  }
}
```

**Pros:**
- No new top-level command; `clawmini up` / `clawmini down` keep meaning.
- The daemon is already the stateful orchestrator; extending it to own adapter lifecycle is consistent.
- Settings-driven: `clawmini services enable discord` toggles a flag, next `up` picks it up. Feels like `clawmini environments enable`.

**Cons:**
- The daemon runs detached already — logs for children would still go to files, not foreground. Doesn't directly solve goal #1 unless we also add a `clawmini logs -f` tail command *and* tell users to use it.
- More responsibility in an already-complex process.
- The daemon currently runs as a detached background process; if an adapter crashes the user has no visibility unless they're already tailing logs.

**Variant B':** daemon supervises adapters *and* the `up` command runs in the foreground by default (only detaches if `--detach`). This converges with Option A but keeps the `up`/`down` command names.

## Option C — Minimum-change: `clawmini logs` + better docs

Leave the process model alone. Add:
- `clawmini logs [-f] [--service <daemon|discord|google-chat|web>]` that tails `.clawmini/logs/*.log`.
- Make adapters log to `.clawmini/logs/adapter-<name>.log` when started (respecting existing stdout for interactive use).
- A one-liner helper script or Makefile-equivalent in the README: `clawmini start-all` shell function that backgrounds the four processes and tails their logs.

**Pros:**
- Cheap. Ships in a day.
- Doesn't close any doors.

**Cons:**
- Doesn't really solve the "too many commands" feeling — users still orchestrate four things.
- Makes goal #3 (`/update`) harder: no single parent to signal, no single source of truth for "what's running right now."

## Option D — Single-process everything

Bundle daemon + adapters + web into one Node process. `clawmini serve` imports each adapter module and starts its lifecycle inline. No subprocesses.

**Pros:**
- Simplest runtime model. One process, one log stream.
- Fastest IPC (they're all in-process — but they already talk over a Unix socket, so this doesn't matter much in practice).

**Cons:**
- Ties adapter crashes to daemon crashes. A Discord.js bug that throws on an unhandled promise kills the daemon.
- Harder to reason about memory limits / CPU.
- Breaks the clean separation where adapters can run on different machines (over TCP) if we ever want that.
- Adapters currently call the daemon over a Unix socket via a tRPC client — merging them means wiring them up differently in "local" mode vs. "remote" mode, which is more code, not less.

I don't think this is the right call — but worth naming to frame the others against.

## Directional preference (for discussion)

**Option A (`clawmini serve` as supervisor of child processes)** is where I'd lean, for three reasons:

1. It's the only option that unambiguously solves goal #1 (visible logs) without relying on a secondary `logs` command.
2. It gives us a clean home for the `/update` operation (goal #3): the supervisor is the thing that knows how to stop, upgrade, and restart the whole constellation. No need to coordinate across multiple independent processes.
3. It maps to patterns users already know (`docker compose up`, `overmind`, `foreman`), so there's no new mental model to learn.

`clawmini up` / `clawmini down` stay as daemon-only commands for people who already have scripts using them — no deprecation needed short-term.

The things I'd still want to pin down (see Open questions) are around how `serve` auto-detects what to run, and exactly what the `/update` protocol looks like.

## Sketch: the `/update` flow (Option A assumed)

Putting this down concretely to see if the design holds:

1. Agent runs `clawmini-lite /update` (or a custom command that ends up sending this signal — TBD how the agent triggers it).
2. The daemon receives the request and dispatches to a new handler: `updateSelf()`.
3. `updateSelf` writes a "restart-requested" marker to `.clawmini/update-pending.json` with:
   - Requested version (or `latest`).
   - Timestamp.
   - Which services were running (so restart is idempotent).
4. The daemon shuts itself down (same path as `clawmini down`).
5. The **supervisor** (not the daemon — the parent `clawmini serve` process) sees the daemon exit cleanly with the marker present. It:
   - Stops all child adapters / web.
   - Runs `npm install -g clawmini@<version>` (or `npm install clawmini@<version>` if local).
   - Re-execs itself (`execvp`) with the new binary on PATH.
6. On restart, the supervisor reads the marker, starts the same set of services, deletes the marker.
7. Agent can notice the restart by the new version string in its next `/ping` response (or via a message from the supervisor once it's back up).

**Why this structure:** the daemon cannot upgrade itself because it's the thing being replaced. It needs a parent that outlives the upgrade. The supervisor is exactly that parent.

**Open edges:**
- If clawmini is installed locally (in the workspace `node_modules`), who runs `npm install`? The supervisor's `cwd` is the workspace — `npm install clawmini@latest` there would update the local install. But if the user installed globally (`npm install -g clawmini`), the supervisor needs to run `npm install -g` — which may need sudo on some setups. We might detect the install location by inspecting `process.execPath` / `require.resolve('clawmini/package.json')`.
- If the install fails mid-way, the supervisor needs a fallback ("old version still works, keep running it") rather than crash-looping.
- If a user invokes `/update` while actively chatting with the agent, there's a dead period. Probably fine (announce it, then do it), but worth naming.
- Agent trust: `/update` runs `npm install` which executes arbitrary scripts. This *is* a privileged operation. Needs the same policy approval flow as any other host-level command — not a built-in "agent can always do this."

## Open questions

1. **What does `clawmini up` / `clawmini down` mean after this ships?** Options: (a) deprecate and alias to `clawmini serve` / `clawmini serve --stop`, (b) keep as daemon-only commands forever, (c) redefine so `up` = `serve --detach` and `down` stops the supervisor. My instinct: (b) — don't break existing workflows; add `serve` alongside.
2. **Auto-detect vs. explicit enable for services?** "Config file present" is a good default heuristic for adapters but ambiguous for web (no config file). Maybe: web is always on, adapters auto-detect, user can `--exclude` to suppress. Or add `services` to `settings.json` (Option B's idea) as an explicit override.
3. **Log format.** Prefixed-line multiplexing is the standard approach; should we ship a JSON mode (`--log-format=json`) for machine consumers? Probably yes eventually, not for MVP.
4. **Log files on disk even in foreground mode?** If `serve` is in the foreground and you `Ctrl+C`, do the logs persist? Teeing stdout to `.clawmini/logs/*.log` even in foreground mode makes post-mortems possible. Cheap to include.
5. **Child restart policy.** If `adapter-discord` crashes, should the supervisor restart it? Backoff? Max retries? I'd say yes with exponential backoff capped at N retries, then give up and log — this is what users expect.
6. **Adapter logs before they connect.** Currently `initGoogleChatConfig` needs to succeed before anything useful happens. The supervisor needs to surface config errors clearly, not just exit code 1.
7. **How does the agent invoke `/update`?** Not a supervisor-design question per se, but: is `/update` a slash command that the daemon interprets, a built-in policy the agent can request, or something else? Easiest path: a router (like `@clawmini/slash-new`) that intercepts `/update` and calls the daemon's `updateSelf` tRPC method.
8. **Does the supervisor need its own PID file / IPC socket?** If we want `clawmini serve --stop` to work from another terminal (instead of only Ctrl+C in the owning terminal), yes — we need a way to find the running supervisor and signal it.
9. **Windows?** Currently the daemon uses a Unix socket; `detached: true` / `unref` semantics differ on Windows. Do we target Windows with this? Status quo is macOS/Linux; probably keep that scope.

## Non-goals

- Reinventing a process manager. If the above gets complicated, we just recommend `tmux` / `overmind` / a launchd plist in the docs and stop there.
- Multi-host orchestration (adapter on server A, daemon on server B).
- Hot-reload of adapters without restart.
- Replacing `.clawmini/daemon.log` outright — it can keep existing as a compatibility artifact; `clawmini logs` just reads the new location.

## Next steps (if we pick Option A)

Rough shipping order that would let us validate before committing fully:

1. **`clawmini serve` foreground-only, no backgrounding.** Spawn daemon inline + adapters as children + web. Multiplex logs with prefixes. Ctrl-C shuts everything cleanly. This is the MVP; it alone addresses goals #1 and #2 (users can `nohup clawmini serve &` if they want detach).
2. **Auto-detect which adapters to start.** Look for config files; optional `--only` / `--exclude`.
3. **`--detach` + `clawmini logs`.** First-class backgrounding with log tailing.
4. **`/update` plumbing.** Supervisor-managed re-exec after `npm install`. Separate spec for that once serve is shipped.

Each step is independently shippable and independently useful.
