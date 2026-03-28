# Product Requirements Document: Adapter Filtering Commands

## 1. Vision & Background
Currently, the Discord and Google Chat adapters have hardcoded rules for which daemon messages they display to the user. Specifically, they only show messages where the role/displayRole is `agent` or `legacy_log`, and they explicitly ignore any messages associated with `subagents`.

As Clawmini becomes more complex and subagents/tools are utilized more heavily, developers and power users need the ability to inspect this hidden traffic. This feature introduces dynamic chat commands (`/show`, `/hide`, `/debug`) that allow users to toggle visibility rules on the fly directly from their chat client.

## 2. Use Cases
*   **Tool Debugging**: A developer wants to see the raw tool requests and responses without looking at the raw daemon logs. They can use `/show tool` to temporarily view tool executions in chat.
*   **Subagent Monitoring**: A user wants to observe the conversation between the primary agent and its subagents. They can use `/show subagent` to unhide subagent messages.
*   **Full Transparency**: A user wants to see everything the daemon is doing. They can type `/show all`.
*   **Post-Hoc Inspection**: A user suspects a subagent failed silently. They type `/debug 5` to see the last 5 messages that the adapter ignored to quickly diagnose the issue.

## 3. Requirements

### 3.1 Chat Commands
The adapters must intercept the following commands and prevent them from being forwarded to the daemon:
*   `/show` - Lists all currently configured message visibility exceptions, as well as the `all` keyword status.
*   `/show [type]` - Adds an exception for `[type]`, saving `{"[type]": true}` to the configuration. This rule is ignored if `all: true` is set.
*   `/show all` - Replaces the configuration with `{"all": true}`.
*   `/hide [type]` - Explicitly hides `[type]`, setting `{"[type]": false}` in the configuration.
*   `/hide all` - Replaces the configuration with `{}`.
*   `/debug <N>` - Fetches and prints the last `N` messages that were ignored by the adapter's current filtering rules.

### 3.2 Configuration Updates
*   The commands must persist their changes to the adapter's `config.json` file so settings apply to future sessions.
*   For immediate effect during the current session, the command handler should update an in-memory configuration reference shared with the forwarder.
*   The configuration schema for both Discord and Google Chat must be updated to support an optional `messages: Record<string, boolean>` property.
*   The forwarders must respect the updated configuration dynamically via the shared in-memory state.

### 3.3 Message Filtering & Formatting Logic
*   **Shared Code**: The logic for deciding whether a message is displayed, formatting it, and parsing the `/show`/`/hide`/`/debug` commands should be extracted to a shared module, like `src/shared/adapters/filtering.ts`.
*   **Subagent Formatting**: When a message associated with a subagent is permitted to pass through the filter (e.g., when `/show subagent` or `/show all` is active), it must be prefixed to indicate its origin or destination. This prefix only applies to the text sent to Discord/Google Chat.
    *   Messages to a subagent (e.g., `role: user`, `displayRole: user`, but `subagentId` is present) should be prefixed with `[To:<id>]`.
    *   Messages from a subagent should be prefixed with `[From:<id>]` or `[<id>]`.

### 3.4 Ignored Messages Debugging (`/debug`)
*   Instead of maintaining a local memory buffer of ignored messages, the `/debug <N>` command should use the daemon API (e.g., `trpc.getMessages.query()`) to fetch recent messages.
*   It should iterate backward over the chat history, applying the adapter's current filtering rules, until it collects `N` ignored messages.
*   **Exclusion Rule**: Messages from the user themselves (`[role=user]` where `subagentId` is undefined) must *never* be included in the debug output, as they are already visible in the chat client. Only daemon messages ignored due to adapter filter rules should be shown.

## 4. Non-Functional Requirements
*   **Security/Privacy**: Only authorized users in the Discord/Google Chat environment should be able to execute these commands (which is already handled by the existing `isAuthorized` checks on incoming messages).
*   **Performance**: The filtering logic must be fast. Fetching messages for `/debug` should use appropriate limits and pagination so it doesn't overload the daemon when searching for ignored messages.