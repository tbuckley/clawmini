# Development Log

## Step 1: Add TRPC Endpoint `fetchPendingMessages`
- Starting implementation of `fetchPendingMessages` TRPC mutation in `src/daemon/router.ts`.
- Updating `src/daemon/message.ts` to handle `AbortError` gracefully.