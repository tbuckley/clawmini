# Development Log

## Progress on Ticket 1
- Analyzed `src/adapter-discord/forwarder.ts` and `src/adapter-google-chat/forwarder.ts`.
- The current filtering logic is:
  ```typescript
  const isAgentDisplay =
    message.displayRole === 'agent' ||
    message.role === 'agent' ||
    message.role === 'legacy_log';
  ```
- I will modify this to include policy requests with `status: 'pending'`:
  ```typescript
  const isAgentDisplay =
    message.displayRole === 'agent' ||
    message.role === 'agent' ||
    message.role === 'legacy_log' ||
    (message.role === 'policy' && message.status === 'pending');
  ```
- Adding policy request forwarding to both adapters and updating unit tests to verify.
- Ticket 1 is now completed.