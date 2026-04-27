---
"clawmini": patch
---

Track skills for every agent, not just `extends`. Forks and hand-written
agents now install and refresh skills via the same SHA-tracked manifest
pipeline, so `up` and `up --dry-run` surface skill plan actions for them
and clawmini upgrades push skill updates universally. `skillsDir: null`
remains the explicit opt-out.
