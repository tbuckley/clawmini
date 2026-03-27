# Questions

1. **Authentication:** Should the adapter authenticate using a Service Account JSON key path provided in the configuration, or rely on Application Default Credentials?
   - **Answer:** It should rely on Application Default Credentials (ADC).

2. **File Attachments:** Should the adapter support downloading file attachments from Google Chat and forwarding them to the daemon (similar to the Discord adapter)?
   - **Answer:** Yes, with a maximum file size of 25MB (unless Google Chat imposes a different limit).
3. **Authorization:** Should the adapter restrict access based on a list of authorized user emails, user IDs, or authorized space IDs? Or a combination?
   - **Answer:** It should restrict access based on specific users (either IDs or emails, whichever is most secure and reliable in the Google Chat API context).
