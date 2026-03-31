1. Does this prefix only apply to user messages, or should it also be added to model responses, tool outputs, or system messages?
**Answer**: Apply it to user messages, system messages, anything with `role=user` or `displayRole=user`.

2. Which timezone should the timestamp use? (e.g., UTC, or the local system timezone?)
**Answer**: It is running on the user's device. It should use the local system time.

3. You mentioned "By default, the `timestampPrefix` setting should be true, but can be set to false. And we may have other values in future." Does this mean the setting should be a boolean for now, or a string/union type (e.g., `boolean | string`) to easily support custom format strings in the future?
**Answer**: A boolean is fine to start.
