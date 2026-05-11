#!/bin/bash
PROMPT="Identify the current project directory, finding the folder in ./docs with the highest prefix (./docs/NN_FEATURE/).

Implement the ONE next ticket in tickets.md:
1. Check what you have done so far (git diff) and read development_log.md.
2. Implement the proposed change.
3. Ensure all verification steps pass.
4. You MUST ALWAYS ensure the checks in ./docs/CHECKS.md all pass. Re-run all checks if you make any changes to address an issue.
5. Update tickets.md to mark your ONE ticket as complete.
6. Commit your changes with a clear explanation of your work.
7. If this was the last ticket, say '<promise>ALL DONE</promise>'
8. Stop working and let the user review your changes.

You MUST frequently update ./docs/NN_FEATURE/development_log.md throughout your work. Track any useful information, steps taken, gotchas, etc."

bash "/Users/tbuckley/projects/gemini-extensions/tbucli/skills/ralph-loop/scripts/setup.sh" --completion-promise "ALL DONE" "$PROMPT"