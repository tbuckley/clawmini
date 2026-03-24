# Product Requirements Document: Subagents

## 1. Vision & Goals

The goal of this feature is to enable agents within `clawmini` to spawn and manage **Subagents**. This allows main agents to delegate long-running or complex tasks, freeing them up to remain responsive to the user or handle other tasks in parallel. Furthermore, subagents can spawn sub-subagents to isolate context and cleanly aggregate information.

This architecture enhances the utility and responsiveness of AI agents by introducing safe, controlled concurrency and context isolation.

## 2. Product / Market Background

Currently, when a `clawmini` agent needs to perform a complex sequence of actions, it must block the main interaction thread until the entire task completes. If the task is long-running (like triaging 100 emails or building a full web application), the agent appears unresponsive to the user.

By allowing agents to spawn background subagents:
- The main agent remains available for new user instructions.
- Tasks can be parallelized (e.g., mapping a subagent to each item in a list).
- Context windows are kept clean, as subagents operate in their own environment and only return a synthesized final output.

## 3. Use Cases

- **Inbox Triage:** A main agent spawns a subagent to read the user's inbox. The subagent reads the email list and spawns parallel sub-subagents for each email to categorize and prioritize them. The subagent gathers these results and notifies the main agent, which wakes up and alerts the user.
- **Background Development:** A user asks the agent to build a web app. The agent spawns a subagent to do the heavy lifting. While the subagent works, the user can continue conversing with the main agent (e.g., summarizing a document). When the subagent finishes, the main agent wakes up and delivers the web app link to the user.
- **Large Codebase Refactoring:** A main agent delegates the refactoring of 5 distinct modules to 5 subagents in parallel, waiting for all to complete before validating the overall project.

## 4. Requirements

### 4.1 CLI Interface for Agents (`clawmini-lite`)
Agents will use the `clawmini-lite` executable to manage subagents. The following new commands must be added:

- `spawn <message> [--agent <name>] [--async] [--id <id>]`
  - Creates a new subagent.
  - If `--agent` is not provided, defaults to the current agent's configuration.
  - Generates a unique ID unless `--id` is provided (throws error if provided ID is not unique).
  - **Behavior (Sync by default for subagents):** Blocks until the subagent completes, returning the final output.
  - **Behavior (Async):** Returns immediately with `Subagent created: <id>`. When the subagent finishes, a notification is sent to the parent agent. (Note: Main agents must *always* execute this asynchronously, overriding the flag if necessary).

- `send <id> <message> [--async]`
  - Sends a follow-up message to an existing subagent.
  - Obeys the same sync/async blocking rules as `spawn`.

- `wait <id>`
  - Blocks the calling agent until the specified subagent completes its current work, then returns the response.

- `stop <id>`
  - Aborts any work the specified subagent is currently doing.

- `delete <id>`
  - Deletes the specified subagent (and stops any current work).

- `list`
  - Lists all subagents associated with the current agent.
  - Output should include: ID, Agent Name, Creation Time, Status (Active/Completed/Failed), and a snippet of the initial message.
  - Note: This lists *all* subagents, including completed/failed ones, until they are explicitly deleted.

### 4.2 Agent Hierarchy & Concurrency

To prevent infinite loops, deadlocks, and resource exhaustion while maximizing parallel execution, strict concurrency controls are required:

- **Maximum Depth:** `MAX_SUBAGENT_DEPTH = 2`.
  - Main agents are depth 0.
  - Subagents spawned by a main agent are depth 1.
  - Sub-subagents are depth 2.
  - Attempts to spawn a subagent at depth 2 will fail.

- **Task Queues & Resource Isolation:**
  - Agents must execute messages they receive in strict order.
  - Every agent is associated with a **Resource** (the directory it operates in) and a **Workspace** (the root chat ID it belongs to).
  - Two agents may run in parallel *only* if:
    1. They operate on different resources (directories), OR
    2. They operate on the same resource but belong to the same workspace (root chat ID).
  - If an agent tries to execute a task but conflicts with an executing agent (same resource, different workspace), its task is queued until the resource becomes available.

- **Global Concurrency Limit:** `MAX_CONCURRENT_AGENTS = 5`.
  - The total number of tasks actively executing across the entire `clawmini` instance simultaneously must not exceed 5.
  - If a `spawn` or `send` request would exceed this limit, the request is placed in a queue.

- **Avoiding Deadlocks & Starvation:**
  - The system must ensure maximum concurrency while avoiding deadlocks and task starvation.
  - **Deadlock Avoidance:** Parent agents blocking on synchronous subagent `spawn`/`send`/`wait` calls still consume a global concurrency slot. The scheduler must ensure that child tasks always have a path to execution. If the global pool is full of parent agents waiting for children that cannot start, the system must detect this and temporarily expand the pool or prioritize the execution of child tasks.
  - **Starvation Avoidance:** The queue manager must prioritize older tasks in the global queue. If the oldest task is blocked by a resource conflict, the system may execute a newer task that has no resource conflicts, provided that agent's own messages still execute in order. Older blocked tasks accrue priority to ensure they are processed immediately once their resource is freed.

### 4.3 Async Notification & Wakeup

When a subagent completes a task and the parent agent is not actively blocking on a `wait` or synchronous `spawn`/`send` command:
- The parent agent receives a notification message formatted as:
  `<notification>Subagent <id> completed. Output: <output_snippet></notification>`
- This notification acts like a standard incoming message:
  - If the parent agent is idle, it wakes up and evaluates the notification.
  - If the parent agent is busy, the notification is added to its message queue to be processed on its next turn.
- Main agents *never* block on a subagent; their interactions are always treated as `--async` internally. Subagents can block on sub-subagents. A subagent cannot be considered "completed" until all of its child subagents have completed and their messages have been received.

### 4.4 Storage and Logging

- **Settings Storage:** Subagent tracking will be stored in `ChatSettings` (`src/shared/config.ts`).
  - Added properties should track `agentId`, `sessionId`, `createdAt`, `status`, and parent hierarchy.
- **Chat Logs (`chat.jsonl`):** Subagent messages will be stored in the *same* `chat.jsonl` file as the main agent.
  - `BaseMessage` will be extended with an optional `subagentId?: string` property.
  - The `ChatLogger` (`src/daemon/agent/chat-logger.ts`) will be updated to allow creating a "subagent view". This view will transparently inject the `subagentId` into outgoing messages and filter incoming logs so the subagent only sees its own context.

### 4.5 Environment & Context

- When a subagent is spawned, it does *not* inherit the specific environment variables, working directory, or router state of its parent.
- Instead, it starts with a **fresh default environment** based on the specified `--agent` (or the default agent if none is provided).

## 5. Detailed Design: Task Queue & Concurrency Management

To satisfy the constraints outlined in Section 4.2, the daemon will implement a **Centralized Task Scheduler** (e.g., in `src/daemon/agent/task-scheduler.ts`).

### 5.1 Data Structures
- **Task:** Represents a single execution of an agent's run loop (e.g., evaluating a new message). Contains `taskId`, `agentId`, `workspaceId` (root chat ID), `resourceId` (directory path), `createdAt` (for priority), and a `run()` closure.
- **Global Task Queue:** A priority queue of pending tasks, sorted by `createdAt` (oldest first).
- **Active Task Pool:** A collection of currently executing tasks. Subject to the `MAX_CONCURRENT_AGENTS` limit.
- **Resource Lock Map:** A map tracking which workspace currently holds the lock for a given resource directory. Key is `resourceId` (directory path), value is `workspaceId` (root chat ID).

### 5.2 Scheduling Algorithm
When an agent receives a message (either a user message or a notification from a subagent), it submits a Task to the Scheduler.

1. **Submission:** The task is added to the Global Task Queue with the current timestamp as its priority.
2. **Evaluation Loop:** The scheduler attempts to promote tasks from the Queue to the Active Task Pool whenever a task completes or a new task is submitted.
3. **Promotion Criteria:** The scheduler iterates through the queue from oldest to newest. A task can be promoted if and only if:
   - `Active Task Pool size < MAX_CONCURRENT_AGENTS` (unless deadlock bypass applies).
   - The task's `resourceId` is either unlocked OR currently locked by the *same* `workspaceId`.
   - AND no older task in the queue from the *same* `agentId` is still pending (enforcing strict ordered execution per agent).
4. **Execution:** Upon promotion, the task is removed from the queue and added to the pool. Its `workspaceId` acquires (or increments a shared hold on) the lock for its `resourceId`. The task's `run()` function executes.
5. **Completion:** When the task finishes, it is removed from the Active Task Pool. The hold on the `resourceId` lock is decremented; if it reaches 0, the lock is released. The Evaluation Loop is immediately triggered.

### 5.3 Deadlock and Starvation Avoidance
- **Starvation Avoidance:** The Evaluation Loop always iterates through the Global Task Queue in priority order (oldest first). If the oldest task is blocked by a resource conflict, the scheduler skips it and checks the next oldest task. This prevents head-of-line blocking while ensuring older tasks naturally accrue priority and get the resource as soon as it's freed.
- **Deadlock Avoidance:** A deadlock can occur if the Active Task Pool is completely full of parent agents that are synchronously blocked (e.g., waiting for subagents to complete) while their required subagents are stuck in the Global Task Queue.
  - **Detection:** The scheduler must track the state of active tasks. If the Active Task Pool is at `MAX_CONCURRENT_AGENTS` capacity and *every* task in the pool is in a "blocked waiting for subagent" state, the system has deadlocked.
  - **Resolution (Pool Expansion):** Upon detecting this state, the scheduler temporarily expands the effective `MAX_CONCURRENT_AGENTS` limit by 1, allowing the oldest eligible subagent task in the queue to be promoted. Once any active task completes, the pool limit shrinks back to its original maximum.

## 6. Non-Functional Requirements (Privacy, Security, etc.)

- **Security:** Subagents operate within the same system permissions as the main agent. Standard sandbox and command restrictions apply.
- **Resource Management:** Ensure that stopped or deleted agents properly release any OS resources (e.g., killing background shell processes they might have spawned).
- **Graceful Degradation:** If the daemon crashes or restarts, subagent states should be recoverable from `ChatSettings` and `chat.jsonl` where possible, or marked as failed if recovery is impossible.

## 7. Implementation Steps

1. **Data Structures:** Update `BaseMessage` and `ChatSettingsSchema` in `src/shared/chats.ts` and `src/shared/config.ts`.
2. **Daemon State:** Implement a concurrency manager in the daemon to track `MAX_CONCURRENT_AGENTS` and handle the blocking/queueing logic.
3. **TRPC API:** Add endpoints in the daemon (`src/daemon/api/index.ts`) for `spawn`, `send`, `wait`, `stop`, `delete`, and `list` subagents.
4. **CLI Implementation:** Add the new commands to `src/cli/lite.ts` mapping to the TRPC endpoints.
5. **Logger Updates:** Refactor `ChatLogger` to support subagent scoping.
6. **Agent Lifecycle:** Update the agent runner logic to handle the parent/child lifecycle, asynchronous wakeups, and depth limits.