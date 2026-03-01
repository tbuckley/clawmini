# Questions

1. **Question:** For offline messages, you mentioned 'allowing the user to send with one tap'. Should the app *only* wait for manual interaction to resend failed messages, or should it also attempt to automatically send them in the background once network connectivity is restored?
   **Answer:** We can auto-send when back online; but users should have a chance to delete them if they are time-sensitive and can't be delivered.

2. **Question:** How should we handle syncing messages when a user returns to a chat after navigating away or returning to the tab from the background? Should we clear the message view and re-fetch the entire history, or just query for any new messages that arrived since the last received message ID?
   **Answer:** Query for any new messages since the last ID seems best.
