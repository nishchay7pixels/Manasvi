# @manasvi/sandbox-runtime

Sandboxed execution runtime for Manasvi.

This package runs a single execution request in a per-run isolated workspace with:

- execution token verification
- runtime policy enforcement (timeout, memory, CPU, filesystem, network)
- explicit secret injection by reference
- structured execution result artifact generation
- execution lifecycle log events

It is used by `apps/execution-manager` as the runtime launch path for validated execution intents and approved artifacts.
