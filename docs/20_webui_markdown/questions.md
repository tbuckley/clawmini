# Questions

1. **Markdown Library:** Do you have a preferred Markdown rendering library for the Svelte frontend (e.g., `marked`, `markdown-it`, `svelte-markdown`)?
    - **Answer:** `marked` works.
2. **Markdown Features:** Are there any specific Markdown features required beyond the standard ones (e.g., syntax highlighting for code blocks, math equations, Mermaid diagrams)?
3. **Toggle Markdown Option:** Should the "Toggle markdown" setting be a globally persisted user setting (like the Debug view), or specific to the current chat session? Where should this toggle be located (e.g., chat header, app settings)?
    - **Answer:** Yes, globally persisted. Located in a global settings menu.
4. **Load Previous Messages UI:** For the "load the previous 100" messages, should this be a physical button at the top of the chat like "Load previous messages...", or an infinite-scroll trigger? (The prompt mentions "a button", so assuming a physical button).
    - **Answer:** Start with a button for now.
5. **Exact Limit:** Should the chunk size be strictly 100 messages, or is this a flexible estimate?