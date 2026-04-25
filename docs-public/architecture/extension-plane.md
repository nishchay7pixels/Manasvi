---
sidebar_position: 8
title: Extension Plane
description: How plugins and the tool registry work
---

# Extension Plane

## What it does

The extension plane manages plugins and the tool registry. It handles the full lifecycle of third-party extensions — from discovery and approval to launch and revocation — and maintains the registry of all available tools.

## The tool registry

The tool registry is the authoritative list of tools that agents can use. It contains:

- All built-in tools (web search, HTTP fetch, file read, shell command, etc.)
- Plugin-contributed tools, once the plugin is approved and running

When the agent runtime parses a model proposal for a tool action, it validates that the requested tool exists in the registry. Tools that aren't registered cannot be invoked.

## Plugin lifecycle management

The extension runtime manages plugins through their complete lifecycle:

```
discovered → validated → pending_approval → approved → running → revoked
```

**Discovered**: A plugin manifest is submitted to the extension runtime.

**Validated**: The manifest is checked for schema compliance. Required fields must be present; capability declarations must be recognized types; claimed risk levels must be consistent with declared capabilities.

**Pending approval**: If the manifest is valid, operator review is required. The extension runtime presents the capability requests for review.

**Approved**: The operator grants capability permissions. The extension runtime records the approval.

**Running**: The plugin process is launched. A cryptographic handshake establishes the communication channel. The plugin's tools are registered.

**Revoked**: The plugin process is terminated. Its tools are removed from the registry. The plugin cannot be re-registered.

## Plugin isolation

Each plugin runs in its own separate process. The communication channel between the plugin and the extension runtime is narrow and explicit — plugins cannot access the host process's memory or internals.

If a plugin crashes or misbehaves, the extension runtime:

1. Detects the failure (missed heartbeats, process exit)
2. Removes the plugin's tools from the registry
3. Logs the failure in the audit trail
4. Notifies the operator

The core system continues operating normally.

## Capability grants

Plugins must declare the capabilities they need in their manifest. The extension runtime enforces these declarations:

- A plugin that declared `access-network` can make HTTP calls
- A plugin that didn't declare `access-filesystem` cannot read files — the capability is not granted even if the plugin asks for it at runtime

Capability enforcement is done at the communication channel level, not just by trusting the plugin to behave correctly.

## Related concepts

- [Plugins](/docs/concepts/plugins) — the plugin concept overview
- [Tools](/docs/concepts/tools) — how tools work
- [Security: Plugin Isolation](/docs/security/plugin-isolation) — the isolation model
