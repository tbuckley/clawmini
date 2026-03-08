# Questions & Answers

**Q1:** How and where will the user review these requests? Should the pending approvals be surfaced via the CLI (e.g., `gemini sandbox list-requests`), the Web UI, Discord, or all of the above?
**A1:** They will be sent to the user via a chat UI.

**Q2:** How should the user configure/register new commands or actions? For example, will they be defined in a JSON/YAML configuration file (like `actions.yaml`), or via a TypeScript API, or through a CLI command?
**A2:** Configuration will likely be JSON for consistency (with YAML as a future option). We want to avoid complex argument parsing definitions. The most critical part of the configuration is identifying whether a path needs to be snapshotted and sent to the daemon. There should also be a file size limit for snapshot transfers.

**Q3:** When a user approves or rejects an action, where and how should the callback execute? For instance, does it run a local script natively on the host, or does it execute a command back inside the sandbox, or simply send an event/message back to the agent in the chat?
**A3:** If approved, the action executes a command configured by the user, which can run either in the agent's environment or on the host. Upon completion or rejection, a callback is triggered. This callback can either be a command executed in the agent's environment or a message sent directly to the agent.
