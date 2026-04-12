# Questions

No questions were required. The investigation into `src/daemon/message.ts`, `src/daemon/routers/slash-policies.ts`, and `src/daemon/routers/session-timeout.ts` yielded the exact root cause of both issues outlined in the prompt. The fix involves correcting a missing parameter in `handleUserMessage` and ensuring `userNotificationMsg` drops the `subagentId` when appending to the chat.
