---
sidebar_position: 6
title: Plugin Isolation
description: How third-party plugins are prevented from affecting the core system
---

# Plugin Isolation

## The risk of extensions

Plugin systems are a common source of security vulnerabilities. When a plugin runs inside the host application's process, it can:

- Access the host's memory (including secrets and session state)
- Call internal APIs that aren't exposed externally
- Crash the host application
- Escalate its privileges by exploiting host code

Most extension systems accept these risks for convenience. Manasvi doesn't.

## Process isolation

Each plugin in Manasvi runs in its own **separate process**. The plugin has no access to the host process's memory. Communication happens through a narrow, explicitly defined API.

This means:

- A plugin cannot read the orchestrator's in-memory state
- A plugin cannot access signing keys or secrets it hasn't been granted access to
- A plugin crash cannot crash the core system
- A compromised plugin cannot directly compromise the orchestrator

## The communication channel

Plugins communicate with the extension runtime through a structured channel with explicit message types. The channel only supports:

- Tool request responses (the plugin handles a tool call and returns a result)
- Health/heartbeat signals
- Shutdown acknowledgments

The plugin cannot send arbitrary messages or call arbitrary functions in the host process. The channel is the complete API surface.

## Capability enforcement

Plugins must declare their required capabilities in their manifest:

- `provide-tools` — declare new tools
- `access-network` — make outbound HTTP calls
- `access-secret` — read specific named secrets
- `access-filesystem` — read/write specific paths

The extension runtime grants capability tokens at launch. When a plugin tries to use a capability it wasn't granted, the request is rejected at the channel level — not just by the plugin's own code.

A plugin that declared `provide-tools` but not `access-network` will find its outbound HTTP calls blocked, regardless of what the plugin code tries to do.

## The launch handshake

When a plugin process starts, it doesn't automatically connect to the extension runtime. It must perform a cryptographic handshake:

1. The extension runtime launches the plugin with a one-time **launch token**
2. The plugin must echo the token back within a time window
3. The runtime verifies the token, establishing that this process was legitimately launched
4. The communication channel is established

A process that presents a valid token proves it was started by the runtime (not a separately-launched malicious process pretending to be a plugin).

## Plugin isolation vs. sandbox isolation

Plugin isolation and tool sandbox isolation are separate controls:

- **Plugin isolation** — the plugin process cannot access the host process
- **Sandbox isolation** — when a plugin's tool is executed, it runs in a sandbox that enforces the tool's declared network and filesystem constraints

Both apply to plugin tools.

## Related concepts

- [Plugins](/docs/concepts/plugins) — the plugin concept
- [Architecture: Extension Plane](/docs/architecture/extension-plane) — plugin lifecycle management
- [Security: Sandboxed Execution](/docs/security/sandboxed-execution) — tool execution constraints
