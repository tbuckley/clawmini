# Questions for Interruptions Feature

1. **Queue behavior on Interrupt:** When a process is interrupted (via `/stop` or `/interrupt`), should we also clear any *other* pending messages currently in the queue for that directory, or just kill the currently active one?
    *   **Answer:** With `/stop`, kill the current task and ignore/clear any pending new messages that haven't been processed yet. With `/interrupt`, stop the current task and batch any other pending messages together into one new message.

2. **Command Syntax:** You mentioned `/interrupt borrow` vs `/stop`. Could you clarify the exact syntax and expected behavior of the slash commands you want to support by default? (e.g., what does `borrow` do specifically?).
    *   **Answer:** "borrow" was just a transcription error. The syntax is `/interrupt` or `/interrupt [extra text]` (e.g., `/interrupt oh also remember to...`), and `/stop`.
3. **Signal Type:** When we send a kill signal, Node.js's `AbortController` with `spawn` defaults to `SIGTERM`. Is this sufficient, or do we need a more aggressive force-kill (`SIGKILL`) or a tiered approach?
    *   **Answer:** Start with `SIGTERM` and see how it works.

4. **System Messages:** Should the automatic reply ("task aborted" or "task interrupted") be appended as a standard `CommandLogMessage` in the chat history?
    *   **Answer:** Keep it simple; use the existing `reply` field that routers can provide.