# Clawmini Architecture

## Overview

Clawmini is a **secure, local-first orchestrator for AI agents**. It provides sandboxing, multi-channel chat interfaces (CLI, Web, Discord), persistent conversation sessions, cron scheduling, and a human-in-the-loop policy approval system. It does **not** run its own LLM — instead it spawns external CLI-based agents (Gemini CLI, Claude Code, etc.) as child processes.

---

## High-Level Architecture

```mermaid
graph TB
    subgraph Clients["Client Layer"]
        CLI["CLI<br/>(Commander.js)"]
        WEB["Web UI<br/>(SvelteKit + Svelte 5)"]
        DISCORD["Discord Adapter<br/>(discord.js)"]
    end

    subgraph Daemon["Daemon Process (Node.js)"]
        direction TB

        subgraph API["tRPC API Layer"]
            USOCKET["Unix Socket<br/>(CLI/Web)"]
            HTTP["HTTP Server<br/>(Agents)"]
            UROUTER["User Router<br/>sendMessage, getMessages,<br/>waitForMessages (SSE),<br/>waitForTyping (SSE)"]
            AROUTER["Agent Router<br/>logMessage, createPolicyRequest,<br/>fetchPendingMessages,<br/>addCronJob"]
        end

        subgraph MessagePipeline["Message Processing Pipeline"]
            RPIPE["Router Pipeline"]
            SLASH_NEW["/new → new session"]
            SLASH_CMD["/command → expand file"]
            SLASH_STOP["/stop → abort queue"]
            SLASH_INT["/interrupt → batch pending"]
            SLASH_POL["/pending, /approve, /reject"]
            CUSTOM["Custom Router<br/>(shell script)"]
        end

        subgraph Execution["Execution Layer"]
            QUEUE["Message Queue<br/>(per-directory, sequential)"]
            EXEC["executeDirectMessage()<br/>session resolution,<br/>command building,<br/>agent spawn"]
            RETRY["Fallback & Retry<br/>(exponential backoff)"]
        end

        subgraph Services["Services"]
            CRON["Cron Manager<br/>(node-schedule)"]
            REQSTORE["Request Store<br/>(policy requests)"]
            POLICY["Policy Service<br/>(file snapshots,<br/>approval workflow)"]
            AUTH["Auth<br/>(HMAC-SHA256 tokens)"]
            EVENTS["Event Emitters<br/>(message, typing)"]
        end

        subgraph Storage["Storage (~/.clawmini/)"]
            CHATS_JSONL["chats/{id}/chat.jsonl"]
            CHAT_SETTINGS["chats/{id}/settings.json"]
            AGENT_CFG["agents/{id}/settings.json"]
            SESSION_CFG["agents/{id}/sessions/{sid}/settings.json"]
            GLOBAL_CFG["settings.json"]
            SNAPSHOTS["tmp/snapshots/"]
            REQUESTS["tmp/requests/"]
        end
    end

    subgraph Agents["Sandboxed Agent Processes"]
        AGENT1["Agent (e.g. Gemini CLI)"]
        AGENT2["Agent (e.g. Claude Code)"]
        LITE["clawmini-lite CLI<br/>(in-sandbox client)"]
    end

    CLI -->|tRPC/Unix Socket| USOCKET
    WEB -->|tRPC/Unix Socket| USOCKET
    DISCORD -->|tRPC/Unix Socket| USOCKET

    USOCKET --> UROUTER
    HTTP --> AROUTER

    UROUTER -->|sendMessage| RPIPE
    RPIPE --> SLASH_NEW
    RPIPE --> SLASH_CMD
    RPIPE --> SLASH_STOP
    RPIPE --> SLASH_INT
    RPIPE --> SLASH_POL
    RPIPE --> CUSTOM

    RPIPE -->|routed state| QUEUE
    QUEUE -->|dequeue task| EXEC
    EXEC -->|on failure| RETRY
    EXEC -->|spawn process| AGENT1
    EXEC -->|spawn process| AGENT2

    AGENT1 -->|Bearer token| HTTP
    AGENT2 -->|Bearer token| HTTP
    LITE -->|HTTP API| HTTP

    AROUTER --> REQSTORE
    AROUTER --> POLICY
    AROUTER --> CRON

    EXEC -->|emit| EVENTS
    EVENTS -->|SSE| UROUTER

    EXEC --> CHATS_JSONL
    EXEC --> SESSION_CFG
    CRON --> EXEC

    AUTH --> AROUTER

    UROUTER --> CHATS_JSONL
    UROUTER --> CHAT_SETTINGS
```

---

## Harness & Conversation Threading Model

### Single-Threaded Serial Queue Architecture

**Clawmini does NOT use multi-threaded or concurrent conversations.** The conversation harness is built around a strictly **serial, single-worker queue per workspace directory**.

The `Queue` class (`src/daemon/queue.ts`) enforces this:
- An `isRunning` boolean gate ensures **exactly one task executes at a time**
- New messages are pushed to a `pending[]` FIFO array
- When the running task completes, `processNext()` automatically dequeues the next
- Each task receives an `AbortController` signal for cancellation support

The queue instances are stored in a `Map<string, Queue>` keyed by the workspace directory (`cwd`), created lazily via `getMessageQueue(dir)`. This means:
- **Within a workspace**: All messages (from all chats, all adapters) are serialized through **one queue**
- **Across workspaces**: Different workspace directories get independent queues and can run concurrently

```mermaid
graph TB
    subgraph ConcurrencyModel["Conversation Threading Model"]
        direction TB

        subgraph SingleWorkspace["Single Workspace (typical setup)"]
            direction TB
            Q["Serial Queue<br/>(ONE per workspace directory)"]

            subgraph Running["Currently Executing"]
                T1["Chat A, msg 1<br/>Agent process running..."]
            end

            subgraph Pending["Waiting in FIFO Order"]
                T2["Chat A, msg 2"]
                T3["Chat B, msg 1"]
                T4["Discord, msg 1"]
                T5["Cron job trigger"]
            end

            Q --> Running
            Running -.->|"completes → dequeue next"| Pending
        end

        subgraph MultiWorkspace["Multiple Workspaces (rare)"]
            direction TB
            QA["Queue for /workspace-A"]
            QB["Queue for /workspace-B"]
            QA_T["msg processing..."]
            QB_T["msg processing..."]
            QA --> QA_T
            QB --> QB_T

            NOTE2["These run concurrently<br/>(separate Map entries)"]
        end
    end

    style NOTE2 fill:#ffffcc,stroke:#cccc00
```

### Why This Matters

The serial queue has important implications:

1. **No parallel conversations**: If Chat A's agent takes 60 seconds, Chat B's message waits the full 60 seconds even though it's a completely different conversation
2. **All adapters share one queue**: A message from Discord, CLI, and Web UI all enter the same queue
3. **Cron jobs also queue**: Scheduled tasks from `CronManager` call `executeDirectMessage()` which enqueues into the same queue
4. **Session state safety**: The serial design prevents race conditions on session files (`agents/:id/sessions/:sid/settings.json`) since only one agent process touches them at a time

### Interrupt as a Concurrency Workaround

The `/interrupt` command is the harness's mechanism for dealing with the serial bottleneck:

```mermaid
sequenceDiagram
    participant U as User
    participant Q as Serial Queue
    participant A as Agent Process

    U->>Q: "Hello" (enqueued, starts running)
    Q->>A: spawn agent
    Note over A: Agent is thinking...

    U->>Q: "Also check X" (queued, waiting)
    U->>Q: "And Y too" (queued, waiting)

    U->>Q: "/interrupt Summarize everything"
    Note over Q: 1. Abort running agent (SIGTERM)<br/>2. Extract pending ["Also check X", "And Y too"]<br/>3. Merge into single XML payload

    Q->>A: spawn agent with merged message
    Note over A: Receives:<br/>&lt;message&gt;Also check X&lt;/message&gt;<br/>&lt;message&gt;And Y too&lt;/message&gt;<br/>&lt;message&gt;Summarize everything&lt;/message&gt;
```

### Session Management Within the Harness

Each conversation thread is tracked by a `(chatId, agentId) -> sessionId` mapping stored in `chats/:id/settings.json`. The harness uses this to decide which agent command to run:

- **New session** (`commands.new`): First message or after `/new` - starts a fresh agent conversation
- **Append to session** (`commands.append`): Subsequent messages - continues existing context using a stored `SESSION_ID` environment variable
- The `SESSION_ID` is extracted from the agent's first stdout via `commands.getSessionId`

---

## Message Lifecycle

```mermaid
sequenceDiagram
    participant U as User (CLI/Web/Discord)
    participant API as tRPC User Router
    participant RP as Router Pipeline
    participant Q as Message Queue
    participant E as Executor
    participant A as Agent Process
    participant AR as tRPC Agent Router
    participant S as Storage (JSONL)

    U->>API: sendMessage(chatId, text, files?)
    API->>RP: executeRouterPipeline(state, routers)

    alt /new prefix
        RP->>RP: Generate new sessionId
    end
    alt /command prefix
        RP->>RP: Expand from ~/.clawmini/commands/
    end
    alt /stop
        RP->>Q: abortCurrent() + clear()
        RP-->>U: Pipeline halted
    end
    alt /interrupt
        RP->>Q: extractPending(sessionId)
        RP->>RP: Batch messages into XML
    end

    RP->>S: Append UserMessage to chat.jsonl
    RP->>Q: enqueue(task, {text, sessionId})

    Note over Q: Sequential per-directory

    Q->>E: dequeue -> executeDirectMessage()
    E->>E: resolveSessionState(chatId, agentId)
    E->>E: Build command + env vars
    E->>E: Set CLAW_CLI_MESSAGE, CLAW_API_URL, CLAW_API_TOKEN

    E->>A: spawn(command, {env, cwd, signal})

    loop Every 5 seconds
        E-->>U: typing indicator (SSE)
    end

    opt Agent calls back
        A->>AR: logMessage / createPolicyRequest
        AR->>S: Append to chat.jsonl / store request
    end

    A-->>E: Process exits (stdout, stderr, exitCode)

    alt Failure + fallbacks configured
        E->>E: Retry with fallback command (backoff up to 15s)
        E->>A: spawn(fallbackCommand)
    end

    E->>E: Extract message content via getMessageContent cmd
    E->>E: Extract session ID via getSessionId cmd
    E->>S: Append CommandLogMessage to chat.jsonl
    E-->>U: New message event (SSE)
```

---

## Module Dependency Map

```mermaid
graph LR
    subgraph shared["src/shared/"]
        config["config.ts<br/>(Zod schemas)"]
        chats["chats.ts<br/>(JSONL R/W)"]
        workspace["workspace.ts<br/>(path resolution)"]
        agentUtils["agent-utils.ts"]
        eventSource["event-source.ts"]
        fetchUtil["fetch.ts<br/>(Unix socket adapter)"]
        lite["lite.ts<br/>(lite client lib)"]
        policies["policies.ts"]
    end

    subgraph daemon["src/daemon/"]
        dIndex["index.ts<br/>(server init)"]
        message["message.ts<br/>(orchestration)"]
        queue["queue.ts"]
        routers["routers.ts"]
        routerSlash["routers/*.ts"]
        cron["cron.ts"]
        auth["auth.ts"]
        events["events.ts"]
        reqStore["request-store.ts"]
        policySvc["policy-request-service.ts"]
        policyUtil["policy-utils.ts"]
        dChats["chats.ts"]
        spawn["utils/spawn.ts"]
    end

    subgraph api["src/daemon/api/"]
        trpc["trpc.ts"]
        userRouter["user-router.ts"]
        agentRouter["agent-router.ts"]
        apiIndex["index.ts"]
    end

    subgraph cli["src/cli/"]
        cliIndex["index.ts"]
        cliClient["client.ts"]
        cliLite["lite.ts"]
        commands["commands/*.ts"]
    end

    subgraph discord["src/adapter-discord/"]
        discIndex["index.ts"]
        discClient["client.ts"]
        discFwd["forwarder.ts"]
        discState["state.ts"]
        discConfig["config.ts"]
    end

    subgraph web["web/src/"]
        appState["app-state.svelte.ts"]
        routes["routes/**"]
    end

    %% Daemon internal deps
    dIndex --> apiIndex
    dIndex --> cron
    dIndex --> events
    apiIndex --> userRouter
    apiIndex --> agentRouter
    apiIndex --> trpc
    userRouter --> message
    userRouter --> events
    userRouter --> cron
    userRouter --> dChats
    agentRouter --> auth
    agentRouter --> reqStore
    agentRouter --> policySvc
    agentRouter --> cron
    agentRouter --> queue
    message --> queue
    message --> routers
    message --> spawn
    message --> events
    routers --> routerSlash
    routerSlash --> queue

    %% Shared deps
    message --> config
    message --> chats
    message --> workspace
    message --> agentUtils
    dChats --> chats
    cron --> config
    reqStore --> workspace
    policySvc --> reqStore
    policySvc --> policyUtil
    policyUtil --> workspace

    %% CLI deps
    cliIndex --> commands
    cliClient --> fetchUtil
    commands --> cliClient
    cliLite --> lite

    %% Discord deps
    discIndex --> discClient
    discIndex --> discFwd
    discFwd --> discState
    discFwd --> cliClient

    %% Web deps
    web --> eventSource
```

---

## Storage Layout

```
~/.clawmini/
├── settings.json                         # Global config (defaultAgent, environments, routers, api)
├── daemon.sock                           # Unix socket for CLI/Web communication
├── agents/
│   └── {agentId}/
│       ├── settings.json                 # Agent config (commands, env, fallbacks)
│       └── sessions/
│           └── {sessionId}/
│               └── settings.json         # Per-session env overrides
├── chats/
│   └── {chatId}/
│       ├── chat.jsonl                    # Message history (UserMessage | CommandLogMessage)
│       └── settings.json                 # Chat config (defaultAgent, routers, jobs)
├── commands/
│   └── {name}.md                         # Slash command expansions
├── environments/
│   └── {envId}/
│       └── env.json                      # Sandbox config (init, up, down hooks, env vars)
└── tmp/
    ├── requests/
    │   └── {id}.json                     # Pending policy approval requests
    ├── snapshots/
    │   └── {file}-{random}               # File snapshots for policy requests
    └── discord/
        └── {file}                        # Downloaded Discord attachments
```

---

## Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| **Per-directory sequential queues** | Prevents race conditions on session files; maintains ordered conversation context |
| **Agent-as-child-process** | Clean isolation; any CLI tool can be an agent; no LLM coupling |
| **HMAC token auth for agents** | Stateless, per-session tokens; no need for persistent credentials |
| **JSONL chat storage** | Append-only, simple, no database dependency |
| **Router pipeline pattern** | Composable message preprocessing; custom routers via shell scripts |
| **File snapshots for policies** | Immutable copies prevent TOCTOU attacks on policy approval |
| **SSE for real-time updates** | Simple, unidirectional streaming; no WebSocket complexity |
