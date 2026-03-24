# Subagents PRD Questions

**Q1:** If an agent attempts to `spawn` a subagent and the `MAX_CONCURRENT_AGENTS` limit (5) has been reached, should the request block/queue until a slot becomes available, or should it immediately fail and return an error?
**A1:** Block until a slot becomes available.

**Q2:** When a main agent receives a notification like `<notification>Subagent <id> completed. Output: ...</notification>`, is this simply appended to the main agent's session log (as a `user` or `system` message) so they see it on their next turn, or does it trigger an immediate wake-up evaluation for the main agent?
**A2:** It should be delivered like a standard message, either waking up the agent if idle or adding it to the queue if busy.

**Q3:** When a subagent is spawned, does it inherit properties like environment variables (`env`), working directory (`cwd`), or router settings from its parent agent's context, or does it start with a fresh default environment?
**A3:** It should get a fresh default environment for whatever agent was specified.

**Q4:** For the `list` command, should it return only currently active subagents, or also completed/failed ones? And how are completed subagents cleaned up (do they persist until `delete <id>` is called)?
**A4:** Return all agents for now. They persist until `delete <id>` is called.