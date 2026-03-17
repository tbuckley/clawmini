# Tickets: Clawmini Skills Command

## Step 1: Refactor Template Skills Directory
- **Description**: Move existing skills currently housed in `templates/gemini-claw/.gemini/skills/` to a newly created `templates/skills/` directory at the project root.
- **Verification**: 
  - Ensure the `templates/skills/` directory contains the skills and `templates/gemini-claw/.gemini/skills/` is removed or empty.
  - Check that each skill contains a `SKILL.md` file.
  - Run `npm run validate` to ensure no build/lint errors are introduced.
- **Status**: Completed

## Step 2: Update Agent Initialization Scaffolding
- **Description**: Update the default agent scaffolding process (`clawmini init` or equivalent template processing) to copy skills from the centralized `templates/skills/` directory into the newly created agent's skills directory.
- **Verification**: 
  - Write or update unit tests for the initialization logic to verify skills are copied from the new location.
  - Run `npm run validate`.
- **Status**: Completed

## Step 3: Implement Target Directory Resolution Logic
- **Description**: Create utility functions to resolve the destination folder for skills based on a target agent's `settings.json`. It should look for a `skillsDir` property in the agent-level `.clawmini/agents/<agentId>/settings.json` (or appropriate path), falling back to `.agents/skills` relative to the agent's root. Handle missing or malformed `settings.json` gracefully.
- **Verification**: 
  - Write unit tests for the directory resolution logic covering custom `skillsDir`, missing `skillsDir`, and missing `settings.json`.
  - Run `npm run validate`.
- **Status**: Completed

## Step 4: Implement `clawmini skills list` Command
- **Description**: Add the `skills list` CLI command to output a list of available skills found in the internal `templates/skills` directory.
- **Verification**: 
  - Write unit tests for the `skills list` command.
  - Run `npm run validate`.
- **Status**: Not Started

## Step 5: Implement `clawmini skills add` Command
- **Description**: Add the `skills add [skill-name]` CLI command. It must support copying the specified skill folder from `templates/skills/<skill-name>` into the agent's resolved skills directory. If `[skill-name]` is omitted, copy all skills. It must completely overwrite the target skill directory if it exists. Include an optional `--agent <agentId>` flag (defaulting to the `default` agent or active environment). Handle errors like "Skill not found" and "Agent not found" clearly.
- **Verification**: 
  - Write unit tests for the `skills add` command, verifying correct copying, overwriting, and error handling for missing skills/agents.
  - Run `npm run validate`.
- **Status**: Not Started
