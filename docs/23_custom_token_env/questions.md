# Questions for Custom Token Env

1. Since we need a way to tell `clawmini-lite.js` which environment variable contains the token, what should we name this "pointer" environment variable? It cannot contain `TOKEN`, `KEY`, or `SECRET` (e.g., `CLAW_API_TOKEN_VAR` would be stripped). Would something like `CLAW_LITE_API_VAR` or `CLAW_AUTH_ENV` work?
   - **Answer:** `CLAW_LITE_API_VAR` is a good choice as it avoids sensitive words.
2. Where should the configuration for the alternative environment variable name live? Should we add an `apiTokenEnvVar` property to the `Agent` schema, the `Environment` schema, or both (with Agent overriding Environment)?
   - **Answer:** The `Agent` schema is the appropriate place. The property name should be `apiTokenEnvVar`.
3. Does `CLAW_API_URL` pass through Gemini CLI without issues, or do we also need to support renaming the URL environment variable?
   - **Answer:** It generally passes through without issues, but we should also allow the user to override it via an `apiUrlEnvVar` property on the `Agent` schema.