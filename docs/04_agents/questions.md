# Questions

**Q1: For the `clawmini agents add <name>` command, should it take any other flags (like `--directory`, `--env`) or just the name, defaulting the directory to `./<name>` and leaving other settings empty for the user to edit manually?**
A: Let's let it provide `--directory ./path/to/dir` and `--env FOO=bar`

**Q2: The prompt mentions that agent config overrides the workspace `defaultAgent` settings. When resolving commands (like `new`, `append`), do we overwrite the whole object or just individual properties? For example, if `defaultAgent.commands.new` is set globally, and the agent only overrides `env`, does the agent inherit the `commands.new` from the global `defaultAgent`?**
A: Yes, the agent should inherit commands from `defaultAgent.commands` and be able to override commands individually.

**Q3: The UI needs to allow users to create new agents. Should the web UI creation form also support specifying the `directory` and `env` variables, matching the CLI?**
A: Yes, but as with the flags they should be optional.

**Q4: Should there be a CLI command to update an existing agent's settings, like `clawmini agents update <name> --env FOO=baz`, or is it expected that users manually edit the `.clawmini/agents/<name>/settings.json` file?**
A: Sure, let's add an update command too.
