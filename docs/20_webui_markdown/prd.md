# PRD: WebUI Markdown Rendering & Pagination

## Vision

The Gemini CLI WebUI provides a conversational interface for users. Currently, messages are rendered as plain text. To improve readability, especially for code snippets, lists, and formatted text returned by agents, we need to introduce Markdown rendering to the WebUI. Additionally, to ensure the UI remains performant as chat histories grow long, we will implement message pagination, loading a limited window of recent messages by default and allowing the user to explicitly load older messages.

## Product/Market Background

Users of developer tools and chat agents expect rich text formatting. Code snippets without syntax highlighting or bolded headers that show as raw text reduce the utility and UX of the product. Additionally, a chat interface that tries to render thousands of DOM nodes at once (especially if they contain complex markdown) will suffer from severe performance degradation, laggy scrolling, and high memory usage. Limiting the initial payload and rendering scope is a standard practice for chat applications.

## Use Cases

1. **Viewing formatted responses:** A user asks the agent for a code example. The agent responds with a markdown code block. The UI renders this block with proper styling, making it easy to read and copy.
2. **Reviewing long conversations:** A user opens a chat that has been active for days, containing 500 messages. To keep the load time and rendering fast, only the last 100 messages are loaded. The user scrolls to the top to see older context and clicks a "Load Previous 100 Messages" button.
3. **Disabling Markdown (Raw View):** A user wants to see the exact raw text output from an agent without any markdown parsing interference. They toggle a global setting to disable markdown rendering.

## Requirements

### 1. Markdown Rendering
- **Library:** Use `marked` for rendering Markdown into HTML within the Svelte components.
- **Rendering:** User messages and agent responses should be parsed and rendered. The markdown should be sanitized to prevent XSS. (Since we are using `marked`, we might need to use `DOMPurify` or `marked`'s internal sanitization/escaping options).
- **Toggle Option:** Provide a globally persisted setting to enable/disable Markdown rendering.
    - When enabled (default), messages are rendered as rich HTML.
    - When disabled, messages are rendered as plain text (similar to the current implementation).
    - The toggle should be accessible via a global settings menu or the UI header.

### 2. Message Pagination (Performance)
- **Default Load:** The `/api/chats/[id]` endpoint and the UI should load at most the last 100 messages of the chat history when a chat is opened.
- **Load Previous UI:** If there are older messages in the history that are not currently loaded, a button should be displayed at the top of the chat container (e.g., "Load previous messages...").
- **Pagination Mechanism:**
    - Clicking the button fetches the preceding batch of messages (up to 100) from the API.
    - The newly fetched messages should be prepended to the current message list.
    - The scroll position should be maintained (the user shouldn't suddenly be jerked to the top or bottom of the newly loaded content).
- **API Updates:** The `/api/chats/[id]` endpoint needs to support cursor-based or limit/offset pagination to fetch older chunks of messages without loading the entire file into memory at once if possible.

### 3. API Changes
- **GET `/api/chats/[id]`**: Needs query parameters to support fetching a specific window of messages (e.g., `limit=100`, `before=<message_id>`).
- **File Reading (`getMessages` in `shared/chats.ts`)**: The backend should be optimized to read the end of the `chat.jsonl` file or parse the file efficiently to return the last N lines, rather than parsing a massive file entirely just to return the last 100 items.

## Non-Functional Requirements
- **Performance:** Rendering markdown shouldn't block the main thread noticeably. Message chunking should keep the DOM size manageable.
- **Security:** Ensure any HTML rendered from markdown is properly escaped/sanitized to prevent Cross-Site Scripting (XSS), even if messages are assumed to be from a trusted local agent.
- **Accessibility:** Ensure the "Load Previous" button is keyboard accessible. Rendered markdown (like lists and headings) should use semantic HTML tags.

## Implementation Steps (Draft)
1. **API Update:** Modify `getMessages` and the `/api/chats/[id]` GET route to support `limit` and `before` parameters. Implement efficient reverse-reading of the `.jsonl` file if necessary.
2. **Global Settings:** Add a global `appState` property for `markdownEnabled` (persisted in local storage or workspace settings). Add a toggle UI for this.
3. **Frontend Markdown:** Install `marked` (and its types/purifier) into the `web` workspace. Create a Svelte component or action for rendering markdown safely. Update `+page.svelte` to use it based on the `appState.markdownEnabled` flag.
4. **Frontend Pagination UI:** Add the "Load Previous" button to `+page.svelte`. Implement the fetching logic to prepend messages and maintain scroll position.
