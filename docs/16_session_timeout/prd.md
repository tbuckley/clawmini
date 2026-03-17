# Product Requirements Document: Session Timeout Router

## 1. Vision
Provide an optional feature that automatically times out inactive chat sessions. After N minutes of inactivity, the system sends an automated notification to the chat (within the context of the timed-out session) and ensures that the user's next message starts in a completely fresh session. This feature will be built as an opt-in router, maximizing the flexibility and composability of the Clawmini router architecture. Users will be able to configure the timeout duration and the prompt sent to the LLM when the session times out.

## 2. Approach & Architecture
We will implement an event-driven timeout mechanism by extending the capabilities of the `RouterState` and utilizing the existing `CronManager`. 

The new `@clawmini/session-timeout` router will dynamically manage its own timeout job on every message processed in the chat. 

### 2.1 Extending `RouterState` for Job Management
Currently, jobs are statically managed via API or settings files. We will extend `RouterState` to allow routers to dynamically schedule or clear background jobs:
```typescript
// src/daemon/routers/types.ts
export interface RouterState {
  // ... existing fields
  jobs?: {
    add?: CronJob[];
    remove?: string[]; // Array of job IDs to remove
  };
  nextSessionId?: string; // Explicitly set the session ID for the *next* message
}
```

**Daemon Integration (`src/daemon/message.ts`):**
After executing the router pipeline, the daemon will inspect `finalState.jobs`. It will:
1. Read the current `chatSettings.jobs`.
2. For each ID in `finalState.jobs.remove`, it will remove the job from settings and call `cronManager.unscheduleJob(chatId, id)`.
3. For each job in `finalState.jobs.add`, it will append/update it in settings and call `cronManager.scheduleJob(chatId, job)`.
4. Save the updated `chatSettings`.

### 2.2 Extending `RouterState` for Session Rotation (`nextSessionId`)
Right now, `state.sessionId` dictates both the session context for the *current* message and the default session for the *next* message.
To support sending a message to the *current* session but starting a fresh session for the *next* message, we introduce `nextSessionId` to `RouterState`.

**Daemon Integration (`src/daemon/message.ts`):**
```typescript
const activeSessionId = finalState.nextSessionId ?? finalState.sessionId ?? crypto.randomUUID();

if (activeSessionId && chatSettings.sessions?.[currentAgentId] !== activeSessionId) {
  chatSettings.sessions[currentAgentId] = activeSessionId;
  settingsChanged = true;
}
```
This tiny change decouples the execution session of the current message from the rotation of the chat's active session.

### 2.3 The `@clawmini/session-timeout` Router
The new router will be completely stateless and driven by the extended `RouterState`.

```typescript
export function sessionTimeoutRouter(
  state: RouterState, 
  config?: { timeoutMinutes?: number; prompt?: string }
): RouterState {
  const timeoutStr = `${config?.timeoutMinutes ?? 15}m`;
  const promptMessage = config?.prompt ?? 'Session expired due to inactivity. Starting a new session.';

  // 1. If this message IS the automated timeout execution
  if (state.env?.__SESSION_TIMEOUT__ === 'true') {
    return {
      ...state,
      nextSessionId: crypto.randomUUID(), // Rotate the session for the next user message
      // We also clean up the job just in case, though one-off jobs clear themselves
      jobs: { remove: ['__session_timeout__'] } 
    };
  }

  // 2. If this is a standard message (from user or agent)
  return {
    ...state,
    // Forward message untouched, but reset the timeout job
    jobs: {
      remove: ['__session_timeout__'],
      add: [{
        id: '__session_timeout__',
        schedule: { at: timeoutStr },
        message: promptMessage,
        env: { __SESSION_TIMEOUT__: 'true' }
      }]
    }
  };
}
```

## 3. Requirements

1. **RouterState Additions:**
   - Add `jobs: { add?: CronJob[], remove?: string[] }`.
   - Add `nextSessionId?: string`.
2. **Daemon Message Pipeline Updates:**
   - Modify `src/daemon/message.ts` to process `finalState.jobs`, interacting with `cronManager` to schedule and unschedule dynamically.
   - Modify `src/daemon/message.ts` to use `finalState.nextSessionId` when assigning the chat's active session for future messages.
3. **New Router Implementation:**
   - Create `@clawmini/session-timeout` router that implements the logic defined in section 2.3.
4. **Configuration Options:**
   - Allow configuration of `timeoutMinutes` (N minutes).
   - Allow configuration of `prompt` (e.g., "This is the end of this conversation. Save any information about the conversation to your daily or long-term memory.").
5. **Testing:**
   - Add unit tests verifying that `jobs` returned by routers are correctly scheduled/unscheduled.
   - Add unit tests verifying `nextSessionId` changes the active session without altering the current execution session.
   - Add unit tests for the `session-timeout` router logic.

## 4. Security & Privacy Concerns
- The automated message will be generated locally and execute within the agent's environment.
- Job IDs should be well-scoped (e.g., `__session_timeout__`) to avoid conflicting with user-defined cron jobs.
- The `cronManager` modifications in `message.ts` must safely handle malformed job configurations returned by custom routers.