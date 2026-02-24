# Questions for Sessions Feature

**Q1: What syntax or library should we use for the JSON queries in `getSessionId` and `getMessageContent`? Should we use a full JSONPath library (e.g., `jsonpath-plus`) or stick to simple dot-notation parsing to keep dependencies minimal?**
A1: Actually, let's use shell commands for `getSessionId` and `getMessageContent` that execute with the output of `new`/`append` sent into them as stdin. This removes the dependency on jsonpath and any assumptions that the output is JSON (callers can use jq to parse).

**Q2: How should the system generate or determine the `<sessionId>` assigned to a chat in `.clawmini/chats/<chatId>/settings.json`? Should it generate a UUID (e.g. `uuidv4`) for new sessions, or something else?**
A2: For now, let's have a --session flag that can specify the session ID. If unspecified, first check the settings; then use 'default' if none
