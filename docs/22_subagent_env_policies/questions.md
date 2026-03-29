# Questions
Q1: To determine if the source subagent and target subagent belong to different environments, should we resolve their environment names based on their configured working directories (using the `environments` mapping in settings.json)? Or is there a different way you'd like an agent's environment to be identified?
A1: Yes, resolve based on configured working directories and finding the environment that most closely matches (same way you decide which env to apply to an agent when running its commands).

Q2: Currently, `PolicyRequest` is strictly structured around running a CLI command (`commandName`, `args`, `fileMappings`). To support subagent spawns and sends, should we introduce a `type` field to `PolicyRequest` (e.g., `type: 'command' | 'subagent_spawn' | 'subagent_send'`) and make the existing fields optional/union-based, or would you prefer a separate tracking structure specifically for pending subagent requests?
A2: could we have a special command, like `@clawmini/subagent_send` or something?

Q3: When a subagent spawn or send request is waiting for human approval, what should the API endpoint (`subagentSpawn` / `subagentSend`) return immediately to the calling agent? Should it return a new status like `status: "pending_approval"`, or should the request block until it's approved or rejected? (Blocking might cause TRPC timeouts if the user takes a long time to respond.)
A3: spawn/send should block if the request is not async. and it should return a failed result if the user rejects the request.
