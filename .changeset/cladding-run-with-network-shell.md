---
"clawmini": patch
---

Fix `run-with-network` policy in the `cladding` environment template so it
accepts shell features. The policy used to invoke
`cladding run-with-scissors <args>` directly, which execs argv inside the
sandbox — so commands with env-var prefixes (`FOO=1 echo $FOO`),
multi-statement commands (`echo a && echo b`), pipes, or redirection failed.

The policy now points at a new `run-with-network.mjs` script that takes
`--command "<shell command>"` (matching the `run-host` interface) and wraps
the string in `cladding run-with-scissors sh -c …` so the full shell grammar
is available. The global `run-host` policy already wraps commands in
`sh -c` and supports these cases.
