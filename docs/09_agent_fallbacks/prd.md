# Product Requirements Document (PRD): Agent Fallbacks

## 1. Vision
To enhance the reliability and resilience of the Gemini CLI application by providing robust fallback mechanisms when agent commands fail. This will allow the application to automatically recover from transient issues, rate limits, or specific command failures, ensuring a smoother user experience.

## 2. Product/Market Background
In AI-driven CLI applications or agentic frameworks, execution errors are common due to external dependencies like API quotas, network timeouts, or model availability. Currently, if an agent fails (e.g., due to an empty response or an error code), the interaction stops, and the user must manually diagnose and retry. By introducing configurable fallbacks, agents can automatically retry operations or switch to alternative configurations (e.g., swapping a `$MODEL` environment variable to use a less restricted model) without user intervention.

## 3. Use Cases
- **Transient Network Errors:** An agent's curl command to an API fails due to a temporary network blip. The fallback simply re-runs the exact same command after a short delay.
- **Quota Exceeded/Rate Limits:** An agent hits a rate limit for an expensive AI model. A fallback changes the `$MODEL` environment variable to a cheaper, higher-quota model and retries.
- **Command Tuning:** An agent's primary prompt strategy fails to produce parsable output (resulting in an empty extracted message). The fallback tries a slightly modified `new` or `append` command with stronger formatting instructions.

## 4. Requirements

### 4.1 Configuration
- Expand the `AgentSchema` in `src/shared/config.ts` to support an array of `fallbacks`.
- A fallback configuration object will contain:
  - `commands`: Optional partial override for `new`, `append`, `getSessionId`, and `getMessageContent`.
  - `env`: Optional partial override of environment variables.
  - `retries`: Optional integer denoting how many times this specific fallback (or the base configuration, if an empty fallback object is provided) should be retried before giving up. Defaults to 1.
  - `delayMs`: Optional base delay in milliseconds before initiating a retry. Defaults to 1000ms.

### 4.2 Error Detection
An agent execution is considered "failed" if:
1. The main command's exit code is not zero (`mainResult.exitCode !== 0`).
2. The `getMessageContent` extraction command yields an empty string (`result.trim() === ''`) after successful execution.

*Note: Command execution timeouts are explicitly out of scope for this feature.*

### 4.3 Execution Logic & Retries
- When a failure is detected, the daemon (`src/daemon/message.ts`) must evaluate the fallbacks in the order they are defined.
- Before executing a fallback, its `env` and `commands` are merged with the original agent configuration.
- Retries for a given fallback will use an **exponential backoff** strategy.
  - Delay calculation: `delayMs * (2 ^ (attempt - 1))`.
  - The maximum delay between retries must be capped at 15 seconds (15,000ms).
- If all retries for a fallback fail, the system moves to the next fallback in the array.
- If all fallbacks are exhausted and the final attempt fails, the standard failure behavior occurs (logging the final error to the user).

### 4.4 Notifications / UX
- Upon detecting a failure that will be retried, a new "log" message must be appended to the chat history.
- The log message format should be: `"Error running agent, retrying in <N> seconds..."` where `<N>` is the computed delay for the current attempt.
- This log message is immediately sent to the user and persists in the chat history.

## 5. Security, Privacy, and Accessibility Concerns
- **Security:** Ensure that merged environment variables do not inadvertently leak secrets into logs. Standard logging practices for command execution must continue to sanitize or hide sensitive variables if applicable.
- **Privacy:** Fallback configurations must reside within the existing user-controlled settings files. No new telemetry or external reporting is introduced.
- **Accessibility:** Ensure that the retry log messages are clear and easily readable in terminal outputs or web interfaces, avoiding excessive spam (the exponential backoff helps mitigate rapid-fire log spam).

## 6. Development Strategy
1. **Schema Update:** Update `AgentSchema` in `src/shared/config.ts` to include `fallbacks`.
2. **Refactor Execution:** In `src/daemon/message.ts`, refactor the core execution inside `executeDirectMessage` to be callable within a retry loop.
3. **Implement Backoff & Retry Logic:** Add the loop with the exponential backoff calculation (capped at 15s) and fallback iteration.
4. **Log Messaging:** Integrate the retry notification log message generation into the retry loop.
5. **Testing:** Update unit tests (`daemon/message.test.ts` or similar) and e2e tests (`cli/e2e/messages.test.ts`) to verify failure detection, correct merging of fallback config, exponential backoff timing logic, and log message creation.
