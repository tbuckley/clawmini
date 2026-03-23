# Questions: Clawmini Skills Command

1. **Source of skills:** When running `clawmini skills add <skill-name>`, where is the CLI fetching the skill from? Should it pull from the `gemini-claw` template built into the CLI, a remote git repository, or a local directory?
   **Answer:** `templates/skills`. We should be able to move the existing skills in `templates/gemini-claw/.gemini/skills` into there, and copy them into the agent's folder when we create it.
2. **Settings configuration:** When specifying a custom directory for skills in `settings.json`, is this configured at the workspace level (`.clawmini/settings.json`), the agent level (`.clawmini/agents/foo/settings.json`), or both? (e.g., `"skillsDir": ".gemini/skills"`)
   **Answer:** Configured at the agent-level. The default path is `.agents/skills`.
3. **Additional commands:** Should we include commands like `clawmini skills list` and `clawmini skills remove` in this initial PRD, or strictly focus on `add`?
   **Answer:** `clawmini skills list` would make sense. `clawmini skills add` should be able to update/reset an existing skill with the same name, replacing it. `clawmini skills add <name>` lets you specify a specific skill to add; omitting `<name>` adds all of them.
4. **Collision handling:** What should the behavior be if a skill with the same name already exists in the target directory? (e.g., fail, overwrite, or prompt?)
   **Answer:** Overwrite.