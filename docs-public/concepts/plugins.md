---
sidebar_position: 4
title: Plugins
description: How third-party extensions work in Manasvi
---

# Plugins

## What is a plugin?

A plugin is a **third-party extension** that adds capabilities to Manasvi — such as new tools, integrations with external services, or hooks into specific events.

The key design principle is: **plugins are untrusted by default**. No matter who wrote a plugin or how sophisticated it is, it cannot access the core system's trust level. It must explicitly request capabilities, and those requests must be approved.

## Why are plugins isolated?

In most extension systems, plugins run inside the main process and can access everything the host application can. This is convenient but dangerous — a buggy or malicious plugin can compromise the entire system.

Manasvi runs each plugin in its own **separate process**. The plugin can only:

- Communicate with the host through a narrow API
- Use capabilities that have been explicitly granted
- Access tools and resources within its approved scope

If a plugin crashes, misbehaves, or is compromised, it cannot affect the core system.

## Plugin capabilities

Plugins must declare what capabilities they need in a **manifest file**:

- `provide-tools` — add new tools to the tool registry
- `access-network` — make outbound HTTP calls
- `access-secret` — read secrets from the secrets store
- `access-filesystem` — read or write files

Each capability family carries a risk level. Low-risk capabilities (like `provide-tools`) can be auto-approved in development mode. High-risk capabilities (like `access-network` or `access-secret`) require explicit operator approval.

## Plugin lifecycle

```
discovered → validated → pending_approval → approved → running
                                                          ↓
                                                       revoked
```

1. **Discovered**: A plugin manifest is registered with the extension runtime
2. **Validated**: The manifest is checked for schema compliance and business rules
3. **Pending approval**: The operator reviews the capability requests
4. **Approved**: Capability grants are issued
5. **Running**: The plugin process is launched and can begin serving tool requests
6. **Revoked**: The plugin is permanently stopped and cannot be re-registered

## Plugin handshake

When a plugin process starts, it performs a cryptographic handshake with the extension runtime:

1. The runtime launches the plugin with a one-time launch token
2. The plugin echoes the token back as proof it was legitimately launched
3. The runtime verifies the token and establishes the communication channel
4. The plugin registers its tools and is marked as active

## How plugins add tools

A plugin can declare new tools in its manifest. Once approved and running, those tools appear in the system's tool registry and can be invoked by the agent — subject to the same policy evaluation and execution controls as built-in tools.

## Related concepts

- [Security: Plugin Isolation](/docs/security/plugin-isolation) — the full isolation model
- [Tools](/docs/concepts/tools) — how tools work in Manasvi
