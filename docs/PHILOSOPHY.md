Clawmini evolves agent CLIs (currently Gemini CLI and OpenCode, and in future Claude Code and Codex) into secure & proactive assistants.

- Secure: can only access the network through allowlisted commands and human approval
- Proactive: always available, always working
- Assistant: one consistent personality across a single long-running chat

The basics

- When users message an agent, Clawmini converts it into a shell command to run and replies with the output.
- Users most often message an agent through a chat app like Discord or Google Chat, though there is a built in web app and CLI for debugging.
- Agents are defined by (1) a command to run when messages are received, usually for an agent CLI; (2) a folder to use as cwd; (3) env vars to set.
- Most agent CLIs allow guiding their behavior via custom system prompts, per-folder AGENTS.md files, and Skills
- Most agent CLIs expose hooks to monitor and adjust their behavior as they run (ex log a tool call before it is run, inject notifications when a tool call finishes, or prevent a model from stopping by sending a next prompt)

Security model:

- The Clawmini daemon exposes separate APIs for users (trusted) and agents (untrusted)
- The Clawmini daemon runs agents inside a sandbox with no network access (except for LLM APIs), so they cannot exfiltrate private data by default; and limited file access so they cannot modify sensitive configuration data
- The Clawmini daemon stores its configuration inside a .clawmini folder within the workspace root, including sensitive files that the agent should not be able to edit like commands to execute; and potentially sensitive files that the agent should not be allowed to read like chats with other agents
- Agents are given a `clawmini-lite.js` script on their $PATH that allows them to interact with the daemon outside the sandbox through the untrusted agent API. The daemon distinguishes trusted (user) from untrusted (agent) callers via a per-workspace `CLAW_API_TOKEN` injected into the agent's environment.
- Agents can request the daemon run user-allowlisted commands outside the sandbox and receive the output. Users decide whether commands run automatically or require human review depending on the sensitivity (ex always ok to read emails or create drafts, but sending an email requires approval). An agent can even request to allowlist new commands!

Proactivity model:

- Agents can schedule messages to send themselves in the future (one-off or recurring), waking up to perform work. Users do not see these scheduled messages, only the agent’s output.
- Agents cannot do any blocking work so they always remain available for the user. For long-running tasks they delegate to a subagent and get notified when it finishes; subagents run to completion and may block on their own async work.
- To avoid huge costs, there is a limit to how many subagents can run in parallel.
- Agents receive any pending messages after each tool call, allowing for steering while the model is running
- If no message should be shared with the user, the agent can respond with NO_REPLY_NECESSARY

Memory model

- Users interact with an agent through a single ongoing chat. However, agent context is limited and quality degrades as it gets longer.
- The agent’s personality and memory are persisted via files; it is instructed to read the personality and recent memory files at the start, and search the memory when appropriate.
- We regularly clear the session after timeout and tell it to save anything important to memory files
