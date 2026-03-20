# Subagents Feature Questions

1. **Subagent Output Message:** When a subagent "finishes working", what should the automatic message sent to the parent chat contain? Should it be the final output of the last command the subagent executed, all of its output, or something else?
   - **Answer/Proposal:** The message should be: "[Automatic message] Sub-agent {id} ({agent-name}) has completed its task.\n\n### Original Request\n{original_message_snippet}\n\n### Final Output\n{final_output}". This provides context and the final result.
2. **Chat ID Validation:** Currently, `isValidChatId` only allows alphanumeric characters, underscores, and hyphens (`/^[a-zA-Z0-9_-]+$/`). To support the `chats/foo/subagents/{uuid}/chat.jsonl` structure, should we update `isValidChatId` to allow slashes, or introduce separate storage logic specifically for subagents?
   - **Answer:** We will use subagent-specific logic where the chat ID format is `{chatId}:subagents:{subagentId}`. The storage directory mapping should map this string to `chats/{chatId}/subagents/{subagentId}/chat.jsonl`.
3. **List Format:** What information should `subagents list` return? Just the IDs, or should it include the agent name, status (running/completed), and creation time?
   - **Answer:** `subagents list` should return the subagent ID, agent name, status (running/completed), creation time, and a snippet of the original message sent to it.
4. **Parent Chat Deletion:** If the parent chat (`foo`) is deleted, should all of its running subagents be automatically stopped and deleted as well?
   - **Answer:** Yes, if the parent chat is deleted, all associated subagents should be automatically stopped and their directories deleted.

5. **Naming `fetch-ongoing`:** Would `clawmini-lite pending-tasks` be an appropriate name for the command that returns unawaited policy requests and subagents?
   - **Answer:** We will use `clawmini-lite tasks pending`. Subagents and policies will both be referred to generally as "tasks" from the subagent's perspective.

6. **Waiting for Policies:** You mentioned `clawmini-lite.js subagents wait 123`. Should policy requests be awaited using a separate `request wait <id>` command, or should there be a unified top-level `wait <id>` command for both subagents and policy requests?
   - **Answer:** We will use a unified `clawmini-lite tasks wait <id>` command that works for both subagents and policy requests. We must ensure IDs are unique between them (e.g. using UUIDs).

7. **Persistence of Ongoing Tasks:** Should the list of a subagent's unawaited tasks (subagents and policy requests) be persisted to disk (e.g., in the subagent's `settings.json`) so they survive a daemon restart?
   - **Answer:** No, if a restart occurs, we will just kill the subagents and notify the main agent of the failure due to restart. The main agent can then decide whether to respawn the subagent.