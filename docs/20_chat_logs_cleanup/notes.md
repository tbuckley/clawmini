# Findings: Chat Logs Cleanup

## Current State of Message Types

`ChatMessage` is currently a union of `UserMessage | CommandLogMessage`.

### `UserMessage`
- `role: 'user'`
- Usually added via `logUserMessage`. Used for the actual user prompt. 
- The user mentioned "which include messages from automated jobs, policy approvals/rejections, and subagent notifications" are logged as `user`. Let's verify where those come from. Wait, they come from `logUserMessage` when the router forwards a system message into the chat, masquerading as the user (e.g. "I have approved your policy..."). This is done in the agent router.

### `CommandLogMessage`
- `role: 'log'`
- Properties:
  - `messageId` (associated user message)
  - `source` (optional, e.g. 'router')
  - `files` (optional string array)
  - `level` ('default', 'debug', 'verbose')
  - `command`, `cwd`, `stdout`, `stderr`, `exitCode`
- Overloaded uses:
  - Tool logs (`logCommandResult`): The most legitimate use of `CommandLogMessage`, populates command, cwd, stdout, stderr, exitCode.
  - System events (`logSystemEvent`): Sets `source: 'router'`, empty strings for command/cwd/stderr.
  - Automatic replies (`logAutomaticReply`): Sets `command: 'router'`, empty stderr, `cwd: process.cwd()`.
  - Command retries (`logCommandRetry`): Sets `command: 'retry-delay'`, empty stderr.
  - Policy Approvals (`routers/slash-policies.ts`): Sets `source: 'router'`, manually fills in `command`, `cwd`, `stdout`, `stderr`, `exitCode`. Rejections set `command: 'policy-request-reject ${id}'`.
  - Lite logs (`api/agent-router.ts`): Sets `command: 'clawmini-lite log...'`.

## Goals
- Break down the overloaded `CommandLogMessage` into specialized types that actually represent what happened.
- Provide clear types for:
  - The initial User Message
  - The Agent's Response (AgentMessage / AssistantMessage - wait, currently agent responses are... where are they logged? Let me check how agent replies are saved. Ah, are agent replies just... wait, they might not be saved? I need to look for `role: 'assistant'` or similar, or `AgentMessage`.)
  - Tool Executions (command, cwd, output)
  - System Events (notifications, retries, auto-replies)
  - Policy Requests / Approvals
- Scalable design for adapters to selectively filter and display messages based on type.

## Questions that need answering
1. Where are agent responses logged? Are they just another type of message?
2. How should we distinguish between User messages that the user *actually* typed vs User messages that are injected by the system?
