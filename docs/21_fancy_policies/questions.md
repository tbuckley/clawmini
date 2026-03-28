# Questions

## Q1: Google Chat Dialogs
**Question:** Google Chat Dialogs (popups) require a synchronous HTTP response to the interaction webhook, which isn't possible using our current async Pub/Sub architecture. For Google Chat, should we add a Text Input field directly onto the card itself for the optional rationale, or should we skip the UI rationale and just have the "Reject" button trigger an immediate `/reject <id>`, leaving the text rationale to be done manually via `/reject <id> <rationale>`?

**Answer:** Let's just skip the input in Google Chat and have the "Reject" button trigger an immediate `/reject <id>`.
