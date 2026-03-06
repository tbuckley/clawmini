# Questions

## Question 1: Environment Definition Config
**Q:** How does `clawmini` know the specific `init`, `up`, `down`, and `prefix` commands for a given environment? Should these be defined in an `env.json` (or similar configuration file) generated inside the `.clawmini/environments/<name>` directory so that users can view and edit them?
**A:** Yes, an env.json file sounds perfect for this.

## Question 2: Dynamic Prefixing and Environment Variables
**Q:** For the `cladding` environment, the prefix needs to inject environment variables specifically formatted as `--env <key>` (e.g., `cladding run --env $CLAWMINI_API_URL --env $CLAWMINI_API_TOKEN`). Since each agent might have different environment variables defined in its `settings.json`, how should this mapping be defined in `env.json`? Should `env.json` support something like an `envFormat` property (e.g., `--env {key}` or `--env {key}={value}`) that `clawmini` uses to construct the prefix dynamically before appending the agent's command?
**A:** Yes, we may indeed add env vars over time, and want to make sure environments will automatically pick them up. I'd defer to you, whether this should be an option in the config, the `prefix` should be a template of some sort, or something else. These environments will often be used as a sandbox, so whatever it is we should ensure it is hard to mess up.

## Question 3: Template Storage and Delivery
**Q:** Where should the built-in templates (`cladding` and `seatbelt`) live in the codebase? Should they be included in `templates/environments/` and copied over when running `clawmini environments enable`, or should they be generated via code inside `src/cli/commands/environments.ts`?
**A:** templates/environments sounds right. We should ensure that an agent doesn't copy that directory though (a custom template named 'environments' would be fine)...

## Question 4: Passing Paths for Seatbelt
**Q:** For the `macos` (seatbelt) environment, you mentioned passing in relevant directories like `$HOME_DIR` and `$WORKSPACE_DIR`. Should these be passed as `-D <key>=<value>` arguments to `sandbox_exec` so the `.sb` profile can use them, or just exported as standard environment variables to the spawned process? If the former, should we perhaps support special variables like `{WORKSPACE_DIR}` in the `prefix` string in `env.json` (e.g., `sandbox_exec -D WORKSPACE={WORKSPACE_DIR} -f sandbox.sb`)?
**A:** yes, these would be vars for the .sb profile; they don't need to be sent to the process (though I think it's fine if they are?). special vars for the prefix string sounds like a good approach!
