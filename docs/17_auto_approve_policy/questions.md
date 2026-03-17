# Auto Approve Policy - Questions

**Q1:** Should the `clawmini-lite request` command block and return the output of the auto-approved policy execution directly to the agent via stdout, or should it exit immediately and inject the results into the chat asynchronously (similar to how manual `/approve` works today)?
**A1:** The `clawmini-lite request` command should block and return the output of the auto-approved policy execution directly to the agent via stdout.

**Q2:** For the FYI debug message, should this be an ephemeral message in the terminal/logs, or a persistent chat message (e.g. `[Auto-approved] Policy X was executed`)?
**A2:** It should be a `debug` level message in the chat history.

**Q3:** To future-proof for the dynamic script evaluation feature, should we set `autoApprove: boolean | string` (where string is the path to a script) in `policies.json` now, or should we stick to just `autoApprove: boolean` for this iteration and introduce a different schema (e.g. `autoApprove: { script: string }`) later?
**A3:** `boolean` is fine for now. We can expand the type (e.g. to `boolean | string`) in the future when we add scripting support.