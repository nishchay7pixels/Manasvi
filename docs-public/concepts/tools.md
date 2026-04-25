---
sidebar_position: 2
title: Tools
description: What tools are and how they work in Manasvi
---

# Tools

## What is a tool?

A tool is a capability that the AI agent can use to take actions in the world — things like fetching a web page, reading a file, running a shell command, or making an API call.

In Manasvi, every tool is:

- **Declared** with a manifest that describes what it does, what inputs it accepts, what capabilities it requires, and what risk level it carries
- **Policy-gated** — before any tool can be used, the policy service must authorize it
- **Sandboxed** — tools execute in an isolated environment with defined network and filesystem constraints
- **Audited** — every tool invocation and its outcome is recorded

## Built-in tools

Manasvi comes with several built-in tools:

| Tool | What it does | Risk level |
|------|-------------|-----------|
| `tool.web-search` | Searches the web for information | Medium (network access) |
| `tool.http-fetch` | Fetches content from a URL | Medium (network access) |
| `tool.local-file-read` | Reads a file from the local filesystem | Low–Medium |
| `tool.shell-command` | Runs a shell command | High (privileged) |
| `tool.memory-note-write` | Writes a note to the agent's memory | Low |
| `tool.approval-request` | Creates a human approval request | Low (workflow control) |

## Tool manifests

Every tool has a manifest that declares:

```
Tool ID: tool.http-fetch
Name: HTTP Fetch
Version: 1.0.0
Action class: access-network
Required capabilities: network.fetch
Sandbox mode: restricted_remote
Network profiles: allowlist (http, https on standard ports)
```

This manifest is the contract between the tool and the system. It determines what the policy engine evaluates and what constraints the sandbox applies.

## How the model uses tools

The model doesn't directly call tools. Instead:

1. The model proposes a tool invocation (e.g., "I want to fetch `https://example.com`")
2. The agent runtime validates this proposal
3. The policy service checks whether this tool is allowed for this user, in this context
4. If allowed, an **execution intent** is created — a signed, time-limited authorization artifact
5. The execution manager validates the intent and dispatches the tool to the sandbox
6. The sandbox enforces the declared constraints during execution
7. The result is returned and recorded

## Why are tools sandboxed?

Sandboxing means the tool runs in an isolated environment with:

- **Network restrictions**: Only the URLs/ports declared in the tool manifest are accessible
- **Filesystem restrictions**: Tools can only read/write within declared paths
- **Output limits**: Tool output is capped to prevent abuse (default 65KB)

This means even if the model tries to misuse a tool (e.g., asking an HTTP fetch tool to call an internal service), the sandbox will block it.

## Adding custom tools

Tools can be added via the plugin system (see [Plugins](/docs/concepts/plugins)). A plugin can declare new tools with custom manifests, inputs, and outputs. Plugin tools must be approved before they can be used.
