# Notes: Clawmini Skills Command

- The CLI uses a folder `.clawmini/` or `.gemini/` for its settings (depending on template or default). Wait, the project is called `skills-cli`, but the CLI executable is `clawmini` based on `index.ts`.
- The user stated: "We continue to add new skills to this template (gemini-claw), but it is difficult to then add those skills to an existing project."
- Goal: Add `clawmini skills add --agent foo` or `clawmini skills add` (default agent).
- By default, skills install to `<agent-workdir>/.agents/skills/`.
- `settings.json` can specify a different directory to place skills. In `gemini-claw`, it specifies `.gemini/skills/`.
- A skill is a folder containing `SKILL.md` and potentially other files.
