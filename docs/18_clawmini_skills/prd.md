# Product Requirements Document (PRD): Clawmini Skills Command

## 1. Vision
To provide a simple, unified interface (`clawmini skills`) for managing agent "skills" within Clawmini projects. As new skills are continuously developed and added to the core templates, users need a straightforward way to inject these updated or new skills into existing agents without manually copying files from the CLI source repository or risking error-prone configuration changes.

## 2. Product/Market Background
Currently, skills are bundled directly into specific templates (like `gemini-claw/.gemini/skills`). While this works for initial project scaffolding, it presents a problem for long-term project maintenance: when new skills are created or existing ones are updated in the template, existing agents have no automated way to adopt them. Developers currently have to manually track updates and copy folders over. 

By centralizing skills into a common `templates/skills` directory and exposing a dedicated CLI command, we empower users to easily distribute and update standard skills across any number of configured agents.

## 3. Use Cases
1. **Adding a New Skill to an Agent:** A user reads about a new skill (e.g., `skill-creator`) in a recent Clawmini release and wants to add it to their existing `default` agent without reinstalling or migrating the agent.
2. **Updating an Existing Skill:** A user wants to update an existing skill (e.g., `clawmini-jobs`) in their `foo` agent because a bug fix or feature enhancement was released in the newest version of Clawmini.
3. **Bootstrapping All Skills:** A user wants to install all currently available template skills into an agent at once.
4. **Listing Available Skills:** A user wants to see what skills they can add to their agent and verify which ones are provided by the CLI templates.

## 4. Requirements

### 4.1 CLI Commands
- **`clawmini skills list`**
  - Outputs a list of available skills found in the internal `templates/skills` directory.
- **`clawmini skills add [skill-name]`**
  - Copies the specified skill folder from `templates/skills/<skill-name>` into the agent's skills directory.
  - If `[skill-name]` is omitted, it copies **all** skills from `templates/skills/` into the agent's skills directory.
  - **Overwriting:** If the target skill directory already exists, it is overwritten completely with the new contents, effectively acting as an "update" or "reset".
  - **Agent Flag:** Supports an optional `--agent <agentId>` flag. If omitted, it defaults to the `default` agent (or the current active agent environment if applicable).

### 4.2 Template Restructuring
- The existing skills currently housed in `templates/gemini-claw/.gemini/skills/` must be moved to a newly created `templates/skills/` directory at the project root.
- The default agent scaffolding process (`clawmini init` or equivalent template processing) should be updated to copy skills from `templates/skills/` into the newly created agent's skills directory.

### 4.3 Directory Resolution
- **Target Directory:** The command must resolve the destination folder for skills based on the target agent's `settings.json`.
- It will look for a `skillsDir` property in the agent-level `.clawmini/agents/<agentId>/settings.json`.
- If `skillsDir` is not specified, it defaults to `.agents/skills` relative to the agent's root directory.
  - *Note: For the `gemini-claw` template, its `settings.json` is expected to override this to `.gemini/skills/` to maintain backwards compatibility or existing conventions.*
- A skill is defined as a directory containing at minimum a `SKILL.md` file, along with any other required artifacts or subfolders.

## 5. Security, Privacy, and Edge Cases
- **Security:** Skills consist of markdown files (`SKILL.md`) and potentially scripts. Overwriting a skill directory could destroy custom modifications the user has made to that skill locally. A warning or explicit documentation is required so users know `add` behaves destructively (overwrite).
- **Edge Cases:**
  - What happens if the `templates/skills/[skill-name]` doesn't exist? The CLI should throw a clear "Skill not found" error and list the valid skills.
  - What happens if the specified `--agent foo` does not exist? The CLI should throw a clear "Agent not found" error.
  - Missing `settings.json`: The CLI should gracefully fallback to the default `.agents/skills` directory if the settings file is missing or malformed, provided the agent directory exists.
- **Accessibility:** Ensure all CLI output uses standard formatting, relies on standard exit codes, and prints human-readable error messages.