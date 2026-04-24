# Auto-update strategy for clawmini

## Problem

`clawmini up` currently only refreshes one thing — the built-in policy scripts in `.clawmini/policy-scripts/` (via `installBuiltinPolicies` at `src/cli/builtin-policies.ts:14`). Everything else clawmini ships — `clawmini-lite.js`, environments, agent templates, skills — is copied into the workspace once at create-time and then never touched again. Upgrading clawmini does not upgrade what's on disk.

Concrete symptoms today:

- **clawmini-lite.js** is exported on demand via `clawmini export-lite` and on daemon startup for environments that declare `exportLiteTo` (`src/daemon/index.ts:63`). After a `npm install -g clawmini` upgrade, environments re-export at the next daemon startup but a manual `clawmini export-lite --out ...` location is silently stale until the user re-runs the export. We don't even refresh the env-based exports in the `up` command itself, only in the daemon's startup hook.
- **Environments** require a full template copy into `.clawmini/environments/<name>/` before they can be enabled (`src/shared/workspace.ts:678`). The vast majority of users never touch the copy, so they're carrying a frozen fork of `templates/environments/macos/sandbox.sb` with no upgrade path.
- **Agent templates** are even worse: the template is destructured at create-time across two locations (`settings.json` lands in `.clawmini/agents/<id>/settings.json` after merging in `directory`/`env`; everything else lands in the agent's working directory, e.g. `./bob/`). There is no record of which template the agent came from once the copy completes, so `BOOTSTRAP.md`, `GEMINI.md`, `TOOLS.md` etc. ossify on the version that shipped when the agent was created.
- **Skills** are template-copied into the agent's `skillsDir` at create-time and never refreshed (`copyAgentSkills` in `src/shared/workspace.ts:439`). Same staleness problem — but with the wrinkle that agents are _expected_ to edit their own skills as they learn, so we can't blindly overwrite.

The user's mental model is "I upgraded clawmini, my workspace should pick up the new defaults." The current model is "I upgraded clawmini, my workspace is a fossil."

## Constraints from the security model

The clawmini security model (see `docs/PHILOSOPHY.md`) shapes what's even possible to auto-update:

- **Agents cannot read `.clawmini/`.** The macOS sandbox profile explicitly denies it (`templates/environments/macos/sandbox.sb:23`). Anything an agent needs at runtime — like the `clawmini-lite.js` shim — must live _outside_ `.clawmini/`, in a path the agent's environment makes accessible (e.g., `.local/bin` for `macos`, `.cladding/tools/bin` for `cladding`).
- **The daemon's config (commands, allowlists) is sensitive.** Auto-update logic runs only on data clawmini ships in its own package; it never reaches into agent-owned files to make decisions about command execution.
- **Agent working directories are agent-writable.** That means we can't assume our last-installed template content is still on disk byte-for-byte; the agent may have edited any file. The auto-update logic must detect divergence and refuse to overwrite.

These constraints are why "put `clawmini-lite.js` on the agent's PATH from a well-known location" is _not_ a viable workspace-default — there's no path inside the workspace that agents can both read _and_ that we can guarantee exists across environments. Each environment (or each agent template) is responsible for declaring where its lite shim lives.

## Goals

1. **`clawmini up` brings the workspace forward.** All upgradeable surfaces refresh on `up` to whatever the installed clawmini ships with, by default.
2. **Local edits win.** Users (and agents) can edit any file, and the auto-updater leaves edited files alone. We never silently overwrite a file that has diverged from what we last wrote.
3. **Per-file upgrade decisions.** For agent templates, the template author decides on a per-file basis which files auto-update on `up` vs. which are seeded once and then owned by the agent (e.g., `MEMORY.md` is the agent's memory — never overwrite; `GEMINI.md` is core instructions — always refresh).
4. **One mechanism, applied consistently.** The same per-file refresh policy and the same SHA-based divergence check apply to agent working-directory files and skills. The only thing that varies between surfaces is the default mode for files not listed in a manifest (seed-once for agents, track for skills).
5. **Overlay > fork.** Where users want to customize a template, they declare overrides in a small overlay file rather than copy-pasting the whole template. This keeps them on the upgrade path.

## Non-goals

- Versioning or migration of user data (chat histories, agent memory files, request stores). Those are owned by the user/agent and never touched by the upgrader.
- Mutating `.clawmini/settings.json` itself on upgrade. That's the user's source of truth.
- Network-fetched updates. The "source of truth" for built-ins is always the installed clawmini package on disk.
- Cross-version backwards-compat for old workspaces. Existing `.clawmini/environments/<name>/` copies and existing agents (without an `extends` field) keep working — they just don't get the upgrade benefit until they opt in. No automatic migration.
- Workspace-default `clawmini-lite.js` placement. Each environment/agent template declares its own export location.

## Core mechanism: `template.json` + SHA tracking

The unifying primitive is a `template.json` file that lives next to a template's content and tells the auto-updater how to handle each file:

```json
{
  "files": {
    "GEMINI.md": "track",
    ".gemini/": "track",
    "SOUL.md": "seed-once",
    "USER.md": "seed-once",
    "MEMORY.md": "seed-once",
    "memory/": "seed-once",
    "BOOTSTRAP.md": "seed-once"
  }
}
```

Two modes per file (or directory entry):

- **`track`** — install/refresh on every `clawmini up`, _unless_ the on-disk content has diverged from what we last wrote. Divergence is detected by storing the SHA of the last-installed content in `.clawmini/agents/<id>/installed-files.json` and comparing it to the current on-disk SHA before refreshing. If they differ (the user or agent edited the file), skip and log a one-line warning.
- **`seed-once`** — install at create time; never touch again. The agent/user owns it.

Files not listed in the manifest default to `seed-once`. This is the safe default — we never auto-modify a file the template author didn't explicitly mark as auto-managed.

A directory entry (`"path/": "track"` or `"seed-once"`) applies recursively to every file under that directory.

**Two universal rules for `template.json`:**

1. The `template.json` file itself is metadata; the auto-updater reads it to know what to do but **never copies it to the destination**. Users don't see template.json in their agent dirs or environment dirs.
2. The first-install time also records SHAs into `installed-files.json`. If a user upgrades clawmini and the manifest didn't exist on the previous version (so no SHA was recorded for a file), `track` files default to "treat as user-owned" — we don't touch them until the user opts in via `clawmini agents refresh <id> --accept`. Strict by default; users explicitly accept the risk.

## Per-surface design

### 1. Built-in policies

**Today:** `installBuiltinPolicies` writes built-in policy scripts to `.clawmini/policy-scripts/` on every `up`, content-hashed to skip no-op writes (`src/cli/builtin-policies.ts:14`).

**Proposal:** no behavior change. The existing approach is the reference pattern: hash-compare, skip on match, atomic write on diff. Documented here as the canonical approach for any "always refresh" surface.

### 2. clawmini-lite.js

**Today:** The daemon re-exports `clawmini-lite.js` to every active environment's `exportLiteTo` on startup (`src/daemon/index.ts:63`). The `clawmini export-lite` CLI command also exists for manual exports to arbitrary paths.

**Proposal:**

- Move the env-based re-export loop to also run inside `clawmini up` itself, before the daemon starts (so an `up` command on a freshly-upgraded clawmini refreshes lite scripts even if the daemon was already running and gets restarted as part of the version bump — see Implementation order).
- Reuse the same content-hash skip pattern: if the on-disk `clawmini-lite.js` matches the bundled one, skip the write. Avoids touching mtimes for tools watching files.
- Refusal: if the existing file is not a known clawmini-lite (no recognizable hashbang/header), log a warning and skip rather than clobbering an arbitrary user file at that path.
- **No workspace-default location.** Agents can't read `.clawmini/`, so there's no universally-readable path we can place the shim in. Each environment declares `exportLiteTo` for sandbox-accessible placement; each agent template can also declare its own export location if it doesn't run inside an environment. We don't auto-place a shim anywhere else.
- `clawmini export-lite` (manual) keeps working as today for one-off cases.

### 3. Environments

**Today:** `enable` copies `templates/environments/<name>/` into `.clawmini/environments/<name>/`, then registers a path mapping in `settings.json` (`enableEnvironment` at `src/shared/workspace.ts:671`). All resolution thereafter reads from the local copy.

Some environments need a real on-disk directory: `init`/`up`/`down` hooks may write state into the env dir, allowlists are runtime-mutable, etc. We're not going to remove the local copy.

**Proposal:** keep today's copy-on-enable behavior, but add an overlay form for users who want small customizations without forking the whole config.

**Default mode (today's behavior):** `clawmini environments enable macos` copies the full template into `.clawmini/environments/macos/`. The user owns the directory; this content does not auto-update. Same as today.

**Overlay mode (new):** the user can hand-write a smaller `env.json` that inherits from a built-in:

```json
{
  "extends": "macos",
  "env": { "MY_VAR": "value" },
  "policies": {
    "my-extra-policy": { "command": "./my-extra.mjs" }
  }
}
```

Resolution: when `readEnvironment(name)` finds an `extends` field, it loads the built-in's `env.json` first and shallow-merges the local fields on top (with `env` and `policies` deep-merged at one level so adding a single env var doesn't drop the rest). The local directory still exists on disk for sandbox profile files, init scripts, runtime state, etc.

For files referenced by the env config (sandbox profiles, allowlist scripts), `{ENV_DIR}` resolution is layered: a relative path resolves first against the local overlay dir, then against the built-in template dir. This means an overlay can reference the built-in's `sandbox.sb` without copying it, but can also override it by placing a local `sandbox.sb`.

`EnvironmentSchema` gets `extends: z.string().optional()`. No CLI flag needed initially — overlays are hand-edited; we can add a `--customize` scaffolder later if it's a common ask.

**No environment auto-refresh of files yet.** Environment files (sandbox profiles, scripts) don't use the `template.json` track mechanism in the MVP. If we want sandbox profile improvements to flow to existing workspaces, that's a future extension — open question below.

### 4. Agents

This is the hardest surface because agent templates split across two locations:

- `settings.json` is _transformed_ (template's `settings.json` is read, `directory`/`env` overrides applied, then written to `.clawmini/agents/<id>/settings.json` — see `applyTemplateToAgent` at `src/shared/workspace.ts:475`).
- All other template files (e.g., `BOOTSTRAP.md`, `GEMINI.md`, `MEMORY.md`, `TOOLS.md` for `gemini-claw`) are copied verbatim into the agent's working directory (e.g., `./bob/`). There is no record of which template they came from.

**Proposal:** track the template link via a single `extends` field on the agent's settings, and use `template.json` to govern working-directory file refresh.

#### 4a. Settings overlay

Add an optional template reference:

```json
{
  "extends": "gemini-claw",
  "directory": "./bob",
  "env": { "GEMINI_API_KEY": true }
}
```

Resolution: `getAgent(id)` first reads the local `settings.json`, then resolves `extends` to the template's `settings.json`, then shallow-merges in this order:

1. Template `settings.json` (the base).
2. Local file's top-level fields (`directory`, `env`, `commands`, `fallbacks`, etc.) — these override the template field-by-field.

`env` and `subagentEnv` are deep-merged at one level (template entries + local entries, local wins on conflict) so the user can add a single env var without dropping the template's defaults. Other fields (`commands`, `fallbacks`, `apiTokenEnvVar`) shallowly override — if the user sets one, they replace the template's value entirely. This matches today's behavior in `applyTemplateToAgent` and is simpler than a deep-merge `patch` block: users either inherit or override at the field level, no nested patch grammar to learn.

`AgentSchema` adds `extends: z.string().optional()`.

**Backwards compatibility:** an agent without `extends` is treated exactly as today (the local file is the full source of truth). `clawmini agents add bar --template gemini-claw` defaults to writing the new overlay shape (with `extends: "gemini-claw"`), so newly created agents auto-update. Existing agents stay frozen unless the user manually adds `extends`.

`applyTemplateToAgent` no longer copies `settings.json` into the agent working dir, merges, and deletes — it just writes the overlay file directly to `.clawmini/agents/<id>/settings.json`. Simpler code path.

#### 4b. Working-directory file manifest

The non-settings template files need per-file upgrade policy. The template ships a `template.json` alongside `settings.json` (copied into the template dir but **not** copied to the destination — see Core mechanism).

For `gemini-claw` specifically, the manifest is:

```json
{
  "files": {
    "GEMINI.md": "track",
    ".gemini/": "track",
    "SOUL.md": "seed-once",
    "USER.md": "seed-once",
    "MEMORY.md": "seed-once",
    "memory/": "seed-once",
    "BOOTSTRAP.md": "seed-once",
    "TOOLS.md": "seed-once",
    "HEARTBEAT.md": "seed-once"
  }
}
```

`GEMINI.md` (the core instructions read at the start of every session) and `.gemini/` (framework config consumed by the Gemini CLI) auto-refresh on `up`. The agent's identity (`SOUL.md`), user profile (`USER.md`), and memory files (`MEMORY.md`, `memory/`) are seeded once and never overwritten. `BOOTSTRAP.md` is one-shot self-deleting; `TOOLS.md` and `HEARTBEAT.md` are reference docs the agent may amend.

The `up` command iterates every agent with `extends` set, reads the template's manifest, and for each `track` entry:

1. Read the current on-disk file's SHA.
2. Compare against the SHA we recorded in `.clawmini/agents/<id>/installed-files.json` for that path.
3. If they match (user/agent hasn't edited it), write the new content + record the new SHA.
4. If they differ, skip and log: `./bob/GEMINI.md differs from template; skipping refresh. Run 'clawmini agents refresh bob --accept' to overwrite.`
5. If no SHA was recorded (the file pre-exists from before this feature shipped), treat as diverged → skip + warn. Strict default; the user opts in once via `--accept`.

Directory entries walk recursively, applying the same per-file rule to every file under the directory. Files added to the directory by the agent (not in the template) are untouched.

**Failure modes called out:**

- File present in template, missing on disk: re-create it (benign re-seeding; SHA recorded).
- File absent from template but present on disk: untouched (it's the agent's own file).
- File present in template, on disk, no SHA: skip + one-time hint (see above).
- Directory `"track"` containing a `template.json`: skipped (manifest files are never copied).

#### 4c. Full-fork escape hatch

`clawmini agents add bob --template gemini-claw --fork` keeps the legacy behavior: copy everything (including `settings.json` merged into the local file with no `extends`), no manifest, no auto-update. The agent is fully owned by the user.

### 5. Skills

Skills are tricky because the agent is _expected_ to modify its skills as it learns — adding examples, refining steps, even creating new skills via the `skill-creator` skill. But clawmini also ships skill updates (bug fixes, new helpers) that should flow to existing agents.

**Proposal:** reuse the same `track` / `seed-once` mechanism as agent files, but with the **opposite default**: unlisted files default to `track` (clawmini ships skill content; the agent gets latest unless it edited). This keeps "one mechanism" while reflecting the different ownership model.

- On `clawmini up`, for each agent with a resolved skills directory: walk `templates/skills/` and for each skill subfolder, refresh files according to its `template.json`.
- A skill's `template.json` is read for per-file declarations and **never copied** to the destination (universal rule).
- **No `template.json` in the skill source:** every file is treated as `track` — refresh unless the on-disk SHA diverges from the recorded SHA. This is the "always refresh if not present" default.
- **`template.json` present:** declared files use their explicit mode (`track` or `seed-once`); files not listed default to `track` (skills-side default — opposite of agents).
- SHA store is the same per-agent `installed-files.json`, with skill paths recorded under their full relative path (e.g., `.gemini/skills/skill-creator/SKILL.md`).
- Same first-install strict rule applies: a file with no recorded SHA is treated as diverged → skip + hint, requires `--accept` to opt in.
- `clawmini skills add <skill-name> -a <agent>` (existing) keeps today's `--force` semantics: overwrites the skill directory unconditionally and re-records SHAs.
- New: `clawmini agents refresh <id>` (see CLI surface) covers skills as part of the same refresh; `--accept` overwrites diverged files for both agent files and skills.

This unifies agents and skills under one code path. The only difference is the default for unlisted files (seed-once for agents, track for skills) — chosen per-surface based on who typically authors content there.

### 6. Surfaces that should _not_ auto-update (called out explicitly)

- **`.clawmini/settings.json`** — user's source of truth. We never write to it during `up`.
- **`.clawmini/policies.json`** — user-curated allowlist. Built-in policies are merged in at read time (`resolvePolicies`), so the file itself doesn't need updating.
- **`.clawmini/chats/*/settings.json`** — chat-level configuration (default agent, routers, jobs, subagent tracking). Owned by the user and the daemon at runtime. No template, nothing to update from. The daemon already migrates this file as needed at runtime.
- **`.clawmini/agents/<id>/sessions/*/settings.json`** — per-session env overrides. Ephemeral, owned by the daemon.
- **Adapter config (`adapter-discord` / `adapter-google-chat`)** — these are separate processes the user runs, with their own config files (e.g., `channelChatMap` state in `src/adapter-google-chat/state.ts`). They aren't part of `.clawmini/`, aren't shipped as templates, and have no upgrade story to manage. If we ever start shipping default adapter config templates (we currently don't), they'd fall under the same overlay-or-fork model. Out of scope here.
- **Environment files (sandbox profiles, etc.)** — see Section 3. No `template.json` mechanism for environments yet; users who want updated sandbox profiles delete and re-enable.
- **Agent working-directory files outside the template manifest** — anything the user or agent has dropped into `./bob/` that isn't in the template's `template.json`. Untouched.

## CLI surface

Minimal additions:

- `clawmini up` (existing) gains:
  - Refresh `clawmini-lite.js` for every active environment that declares `exportLiteTo` (content-hashed; was previously only run by the daemon's startup hook).
  - Refresh `track`'d files for every agent that has an `extends` field, skipping diverged files and updating the SHA store.
  - Refresh skills for every agent the same way (using the skills-side default of `track` for unlisted files).
  - Existing built-in policy install runs unchanged.
  - On clawmini-version mismatch with a running daemon: stop + restart, so the daemon re-runs its environment hooks.
  - New flag `--dry-run`: print the per-file plan (refresh / skip-diverged / skip-unchanged) and exit without writing. Lets cautious users preview the blast radius.

- `clawmini agents add <id> --template <name>` (existing): default writes the overlay shape (`extends`, `directory`, `env`). Add `--fork` for the legacy full-copy behavior.

- `clawmini agents refresh <id>` (new): manually re-run the agent's track-file refresh (both working-dir files and skills) outside of `up`.
  - `--accept`: overwrite files that have diverged from their recorded SHA. Acknowledges the user is okay losing edits to those specific files. Same flag covers agent files and skills — there's no separate `--force-skills` toggle.
  - `--dry-run`: same semantics as `up --dry-run` but scoped to one agent.

- `clawmini skills add <skill-name> -a <agent>` (existing): keeps today's `--force` overwrite semantics for one-shot installs.

- `clawmini agents diff <id>` (nice-to-have, not blocking): show which `track` files have diverged from the template. Helps the user understand what `up` will skip.

- `clawmini environments enable <name>` (existing): no flag changes. Overlay mode is hand-edited; full copy is the default. We can add a `--customize` scaffolder later.

## Implementation order

1. **Lite refresh on `up`.** Move the daemon's `exportLiteToEnvironment` loop into `clawmini up` (still also runs in the daemon, for the case where the daemon starts via something other than `up`). Adds the refusal-on-unknown-content guard. No schema changes; ships independently.
2. **Add `extends` to `EnvironmentSchema` and overlay merge in `readEnvironment`.** Layered `{ENV_DIR}` resolution in `src/daemon/agent/agent-context.ts`. No CLI changes; verify by hand-creating an overlay file.
3. **Add `extends` to `AgentSchema` and rewrite `applyTemplateToAgent`.** New agents created with `--template` write the overlay shape. `getAgent` resolves `extends` and shallow-merges (with one-level deep-merge for `env`/`subagentEnv`). Existing agents (no `extends`) unchanged. Pure read-side change — no `up`-time refresh yet.
4. **Add the `template.json` manifest, the file-tracking SHA store, and the universal "never copy `template.json`" rule.** Ship `template.json` for the templates that have one (`gemini-claw` first; others can opt in incrementally). Create `.clawmini/agents/<id>/installed-files.json` per agent. New agents created with `--template` get their tracked files refreshed at create time + SHAs recorded.
5. **Wire agent refresh into `clawmini up`.** Walk every agent with `extends`, refresh tracked files (skip diverged with warning), update `installed-files.json`. Same logic powers `clawmini agents refresh`.
6. **Skills refresh on `up`.** Reuse the step-4/5 manifest+SHA mechanism for skills, with the skills-side default of `track` for unlisted files. Skill `template.json` files are skipped on copy (universal rule). SHAs share `installed-files.json` keyed by full relative path.
7. **`--dry-run` plumbing for `up` and `agents refresh`.** Print the per-file plan (refresh / skip-diverged / skip-unchanged) and exit without writing.
8. **(Optional polish) `clawmini agents diff` and `clawmini environments enable --customize`.**

Each step is independently shippable. After step 1 the lite-staleness problem is fixed for environment-based workflows. After step 6 the whole upgrade story is uniform; step 7 is the safety-net flag for cautious users.

## E2E test plan

All tests use the existing `TestEnvironment` harness in `e2e/_helpers/test-environment.ts` and the `env.runCli([...])` pattern. New file: **`e2e/cli/auto-update.test.ts`** for the cross-cutting flows; surface-specific assertions can extend the existing `e2e/cli/{init,agents,skills,export-lite}.test.ts` suites.

Each test below names what it asserts; the harness gives us isolated `.clawmini/` dirs and a real subprocess CLI invocation per test.

### Lite refresh on `up`

1. **`up refreshes clawmini-lite.js for active environments`** — enable `macos`, run `up`, verify `${env.dir}/.local/bin/clawmini-lite.js` exists and matches the bundled shim's content (compare SHA-256). Then mutate the bundled shim source on disk in the test fixture (write a sentinel string into the staged copy used by `resolveCompiledScript`), run `up` again, verify the file is overwritten.
2. **`up skips lite write when content matches (no mtime touch)`** — record `mtime` after first `up`, run `up` again immediately, assert mtime unchanged.
3. **`up refuses to overwrite a non-clawmini file at the export path`** — pre-write arbitrary content (no hashbang, no recognizable header) at `.local/bin/clawmini-lite.js`, run `up`, assert the file content is unchanged and stderr contains a warning.
4. **`up does not place a default lite shim when no environment is active`** — run `init` + `up` with no `environments enable`, assert no `clawmini-lite.js` is created anywhere in the workspace outside `.clawmini/`.

### Environment overlay

5. **`environment with extends inherits built-in env.json fields`** — write an overlay `env.json` containing `{"extends": "macos", "env": {"MY_VAR": "v"}}`, register it via settings, run a daemon command that reads the resolved environment, assert the resulting config has the macOS `prefix`/`exportLiteTo` (from the built-in) plus `MY_VAR=v` (from the overlay), and that `env` from the built-in is preserved (deep-merge at one level).
6. **`{ENV_DIR} resolution falls back to built-in for missing local files`** — overlay env has no `sandbox.sb`; assert that `prefix` references the built-in package's `sandbox.sb` path. Then place a local `sandbox.sb` next to the overlay; assert the local one wins.
7. **`environments enable still copies by default (no extends added)`** — `environments enable cladding`, assert `.clawmini/environments/cladding/env.json` is a full copy with no `extends` field — backwards-compatible behavior.

### Agent settings overlay

8. **`agents add --template writes overlay shape with extends`** — `agents add bob --template gemini-claw`, assert `.clawmini/agents/bob/settings.json` contains `extends: "gemini-claw"` and only the create-time fields (`directory`, possibly `env`), not the full template merged in.
9. **`getAgent merges template fields into local fields`** — read the agent via the daemon API and assert the resolved settings include the template's `commands`, `apiTokenEnvVar`, `fallbacks`, etc.
10. **`local field overrides template field shallowly`** — write a local `commands.new` that differs from the template; assert the resolved value is the local one.
11. **`env deep-merges one level`** — template defines `env: {MODEL: "x", API_KEY: true}`, local defines `env: {MODEL: "y"}`; assert resolved `env` is `{MODEL: "y", API_KEY: true}`.
12. **`agents add --fork copies everything and writes no extends`** — `agents add bob --template gemini-claw --fork`, assert `.clawmini/agents/bob/settings.json` has no `extends` and contains the fully-merged template fields inline (legacy shape).
13. **`existing agent without extends is unchanged after up`** — pre-create an agent with the legacy shape (no `extends`); run `up`; assert `.clawmini/agents/<id>/settings.json` and the agent dir are untouched.

### Agent working-dir refresh

14. **`new agent with --template records SHAs and creates installed-files.json`** — `agents add bob --template gemini-claw`, assert `.clawmini/agents/bob/installed-files.json` exists and contains entries for every file in `gemini-claw`'s manifest with their SHAs.
15. **`up refreshes a track'd file when on-disk SHA matches recorded SHA`** — modify the bundled `gemini-claw/GEMINI.md` template content (sentinel), run `up`, assert `./bob/GEMINI.md` now has the new content and the SHA in `installed-files.json` was updated.
16. **`up skips a track'd file when on-disk SHA differs (user edited)`** — edit `./bob/GEMINI.md` to add a sentinel line, run `up`, assert the file is unchanged and stderr contains a warning naming the file and suggesting `--accept`.
17. **`up never touches seed-once files`** — modify the bundled `MEMORY.md` template, run `up`, assert `./bob/MEMORY.md` is unchanged (it's `seed-once`).
18. **`up never touches files outside the manifest`** — drop `./bob/some-agent-file.md` (not in template); run `up`; assert untouched.
19. **`up re-creates a track'd file that was deleted`** — `rm ./bob/GEMINI.md`, run `up`, assert the file is recreated from the template and the SHA recorded.
20. **`up does not copy template.json to the destination`** — assert `./bob/template.json` does not exist after agent creation or after `up`.
21. **`pre-existing agent without recorded SHAs gets strict skip + hint`** — pre-create an agent with `extends` but no `installed-files.json`, edit `./bob/GEMINI.md` matching the template byte-for-byte (so it would be safe to refresh), run `up`, assert the file is still skipped (no recorded SHA → diverged) and stderr suggests `agents refresh --accept`.
22. **`directory entry walks recursively`** — template manifest has `".gemini/": "track"`, multiple files under `.gemini/`; `up` refreshes all of them, recording SHAs for each path.

### Skills refresh

23. **`up refreshes all skill files when no template.json is present`** — modify a bundled skill's `SKILL.md`, run `up`, assert the on-disk skill content is updated and SHA recorded under the full path in `installed-files.json`.
24. **`up skips diverged skill files`** — agent edits `<skillsDir>/skill-creator/SKILL.md`, run `up`, assert the file is skipped + warning logged.
25. **`skill template.json marks file seed-once`** — ship a test skill with `{"files": {"examples/": "seed-once"}}`, agent edits an example, run `up`, assert the example is untouched even after a bundled update.
26. **`skill files unlisted in template.json default to track`** — same test skill has unlisted `SKILL.md`; modify the bundle's `SKILL.md`; run `up`; assert it's refreshed (skills-side default = track).
27. **`skill template.json itself is never copied`** — assert `<skillsDir>/<skill>/template.json` does not exist after `up`.
28. **`skills add --force overwrites diverged files unconditionally`** — agent edits `<skillsDir>/skill-creator/SKILL.md`, run `clawmini skills add skill-creator -a bob` (no `--force`) — assert today's behavior (which is force-overwrite per current code at `src/cli/commands/skills.ts:62`).

### `agents refresh` and `--accept`

29. **`agents refresh <id> runs the same pass as up but scoped`** — set up two agents, edit one's `GEMINI.md`, run `agents refresh other-agent`, assert only the other agent's SHAs are touched (no side effect on the edited agent).
30. **`agents refresh --accept overwrites diverged files`** — agent edits `GEMINI.md`, run `agents refresh bob --accept`, assert the file is overwritten with template content and the SHA re-recorded. Same flag works for skill files.

### `--dry-run`

31. **`up --dry-run prints a plan and writes nothing`** — set up a workspace where some files would refresh, some would skip-diverged, some are unchanged; run `up --dry-run`; assert stdout names each category, no on-disk file changes (stat all template-tracked files before/after; SHAs in `installed-files.json` unchanged).
32. **`agents refresh --dry-run prints scoped plan`** — same idea, scoped to one agent.

### Built-in policies (regression)

33. **`up still installs built-in policy scripts unchanged`** — existing behavior; assert `.clawmini/policy-scripts/run-host.js` and `propose-policy.js` exist after `up` and content matches the bundled scripts. This guards against the new logic accidentally breaking the existing install path.

### Cross-surface

34. **`up runs all four refreshes in one invocation`** — fresh workspace with an agent + active environment + skills + policies; run `up` once, assert lite is exported, agent files refreshed, skills refreshed, policy scripts present, all in one command.
35. **`up exits non-zero if any refresh fails`** — make one of the refreshes fail (e.g., template path unreadable); assert `up` exits non-zero and the error message names the failing surface. Other surfaces still attempt their work (failures don't short-circuit) — verify by checking that policy scripts are still installed even if the agent refresh fails.

All tests must run with `npm run validate` green before merge. Tests that mutate the bundled template content (#15, #23, #25, #26) do so against a copy staged in the test environment, not the real package — the harness needs a small extension to point template resolution at a test-controlled directory.

## Decided (was open questions)

1. **Per-file SHA store location:** per-agent at `.clawmini/agents/<id>/installed-files.json`. Orphaned by `deleteAgent` already. Skill SHAs go into the same file under the skill's full relative path.
2. **Environment files using `track`/`seed-once`:** out of scope for the MVP. Environments stay copy-once; users delete + re-enable to get sandbox profile updates. Revisit if asked.
3. **First-refresh strictness (no recorded SHA):** strict — skip + hint, require `--accept`. Agents actively edit files; silent overwrite is the worse failure mode.
4. **Versioned templates:** not in scope. Templates ship as one version per clawmini package version.
5. **`--dry-run` flag:** added on `up` and `agents refresh`. Prints the per-file plan without writing.
6. **Skills `template.json`:** supported, with skills-side default = `track` for unlisted files (opposite of agents). One mechanism, two defaults.
