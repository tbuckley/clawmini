---
"clawmini": patch
---

Fix release workflow: install Playwright browsers before running
validate so the web tests pass on CI, bump Node to 24, and switch npm
publishing to Trusted Publishing via OIDC instead of an `NPM_TOKEN`.
