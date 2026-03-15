# Questions

## Q1
**Question:** For implementing the inactivity timeout, I have identified two main approaches that leverage existing infrastructure:
1. **Leveraging `CronManager`:** Whenever a message is sent, schedule (or reschedule) an `at: N minutes` job for the chat. If the user replies before N minutes, the job resets. If not, the job fires, sending the automated message and forcing a new session.
2. **Global Polling Interval:** A background interval runs every minute, checking the last message timestamp of all active chats. If the inactivity exceeds N minutes, it triggers the automated message and new session.

Which of these approaches do you prefer, or should I detail both in the PRD?

**Answer:** TBD