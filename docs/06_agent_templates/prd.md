# Agent Templates

## Vision
To provide a smooth and predictable onboarding experience for new agents by enabling pre-configured templates. These templates give users a solid starting point for their agents, complete with files and configurations, saving time and reducing errors when setting up boilerplate environments.

## Product / Market Background
Currently, users add agents with `clawmini agent add <id>`, which creates a raw configuration and optionally an empty working directory. As the system scales and use-cases expand, users often need specialized agents (e.g., specific prompting frameworks, pre-installed tool configurations, or project structures). Allowing folder templates bridges this gap by letting users seed an agent's working directory with necessary files and configurations.

## Use Cases
1. **Quickstart Default:** A user creates an agent with `clawmini agent add foo --template default`. The `default` template provides an initial structure (e.g., standard files or instructions) ready for immediate use.
2. **Custom Workflows:** A user defines a project-specific template in `.clawmini/templates/my-custom-agent` and uses `clawmini agent add bar --template my-custom-agent` to initialize an agent with standard tools tailored for their current workspace.
3. **Configuration Inheritance:** A template provides default environment variables or descriptions in a `settings.json` file. When the agent is created, these settings are merged, saving the user from manually typing out complex environment parameters.

## Requirements
1. **CLI Flag (`--template <name>`):** The `clawmini agent add <id>` command must accept an optional `--template <name>` flag.
2. **Template Resolution:**
   - First, search in `.clawmini/templates/<name>`.
   - If not found locally, search in built-in templates. Built-in templates will be located at a package-level `templates/` directory (accessible via `import.meta.url` or standard path resolution relative to `dist/cli`).
3. **Directory Constraints:**
   - If the agent's resolved working directory already exists and is **not empty**, the command MUST fail, preventing accidental overwrites.
4. **Copy Process:**
   - The entire contents of the resolved template folder must be copied to the new agent's working directory recursively.
5. **Configuration Handling (`settings.json`):**
   - After copying, if a `settings.json` file exists in the copied directory, it must be read and validated against `AgentSchema` (ignoring strict workspace checks during read).
   - If valid, this configuration becomes the default state of the new agent.
   - **Important:** If the template's `settings.json` includes a `directory` field, it MUST be explicitly ignored, and a warning should be printed to the user indicating that template directory configurations are ignored. If no `--directory` flag is specified, the agent's working directory will be created in the default folder (`./<agent-id>`).
   - The CLI flags (`--env`, `--directory`) provided by the user MUST override matching values from the template's `settings.json`.
   - The `settings.json` file MUST be removed from the agent's working directory after processing.
6. **Built-in Templates Accessibility:**
   - The build process must be updated or source code logic must guarantee that the `templates/` folder is accessible by the CLI binary after the project is built. Since `tsdown` is used, resolving `templates/` relative to `__dirname` or using a copy-plugin might be necessary. Given Node's `import.meta.url`, resolving paths to `../../../templates` from the built code is a common approach.

## Open / Technical Concerns
- Built-in template location: Ensuring `dist/` execution properly resolves the `templates/` folder. A reliable method like `path.join(path.dirname(fileURLToPath(import.meta.url)), '../../templates')` should be tested during implementation.
- Race conditions: Validating the target directory is empty before starting the asynchronous copy process.
