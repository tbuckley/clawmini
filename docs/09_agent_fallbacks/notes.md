# Agent Fallbacks Research Notes

## Current State

**Agent Configuration (`src/shared/config.ts`)**
- `AgentSchema` currently has `commands`, `env`, and `directory`.
- No fallback logic exists.

**Execution Logic (`src/daemon/message.ts`)**
- `executeDirectMessage` runs the main command (either `new` or `append`).
- `mainResult` gives `stdout`, `stderr`, and `exitCode`.
- If `exitCode === 0`:
  - It tries to extract the session ID (if `getSessionId` is defined).
  - It tries to extract the message content (if `getMessageContent` is defined).
- The `logMsg` is created and appended to the chat.

## Proposed Changes for Fallbacks

**Configuration**
- Add an array of `fallbacks` to `AgentSchema`.
- Each fallback could have:
  - `commands` (Partial override of `new`, `append`, `getMessageContent`, `getSessionId`)
  - `env` (Partial override of environment variables, e.g., `$MODEL`)
  - `delayMs` (Optional backoff time before executing the fallback)

**Detection of Errors**
- Failure condition 1: `mainResult.exitCode !== 0`.
- Failure condition 2: `getMessageContent` results in an empty string (`result.trim() === ''`).

**Execution Loop**
- Wrap the main execution block in `executeDirectMessage` inside a retry loop.
- The loop tries the base agent configuration first.
- If it fails, and there are fallbacks left, it picks the next fallback, merges its `env` and `commands` into the base agent config.
- Before running the fallback, if a delay is specified, it appends a message to the chat: "Error running agent, retrying in N seconds..." and waits.
- Empty fallback config just reruns the original command.

## Questions for PRD
- Should the retry message be a standard system message or replace the previous message?
- Are fallbacks evaluated one-by-one in sequence, or is there a max retry count for a single fallback?
- Should we add a `timeout` configuration for the command itself as part of failure detection?
