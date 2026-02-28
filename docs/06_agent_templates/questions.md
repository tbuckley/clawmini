# Agent Templates Questions and Answers

**Q1:** Where are the "built-in templates" located? Is it the `templates/` folder at the root of the project?
**A1:** Wherever makes the most sense. The project is built to `./dist` with `npm run build`, so it must maintain access to the templates.
*(Note: I will propose copying the `templates/` folder to `dist/templates` during the build process, or resolving from `dist/../templates` in the source code.)*

**Q2:** If the template's `settings.json` includes a `directory` field, should it be ignored, used as the default unless overridden by an explicit `--directory` flag, or something else?
**A2:** The `directory` field should always be ignored, likely with a warning.

**Q3:** Should the agent creation (and template copying) fail if the destination working directory already exists and is not empty?
**A3:** Yes, it should fail if the directory is not empty.