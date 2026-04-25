---
sidebar_position: 5
title: Sandboxed Execution
description: How tools run in constrained environments
---

# Sandboxed Execution

## What sandboxing means

When Manasvi executes a tool, it doesn't run the tool with full access to the system. It runs it in a **sandbox** — an isolated environment with explicitly declared and enforced constraints.

A sandboxed tool can only:
- Access the network destinations listed in its manifest
- Read/write the filesystem paths it declared
- Produce output up to the configured size limit
- Run for up to the configured time limit

Anything outside those declarations is blocked at the sandbox level — not just discouraged.

## Why sandboxing matters for AI agents

The AI model may be instructed (or manipulated) into requesting a tool to do something beyond its intended scope. For example:

- A web fetch tool might be asked to call an internal API that wasn't the intended target
- A file read tool might be asked to read a sensitive file outside the expected directory
- A shell command tool might be asked to exfiltrate data over the network

Without sandboxing, the tool would do whatever the model requested. With sandboxing, the declared constraints are enforced regardless of what the model requests.

## Tool manifests as contracts

Each tool's manifest declares its execution constraints:

```
Tool ID: tool.http-fetch
Sandbox mode: restricted_remote
Network profiles:
  - allowlist: [http, https on standard ports 80/443]
Filesystem access: none
Output size limit: 65KB
Time limit: 30s
```

This manifest is the **contract** between the tool and the sandbox. The sandbox enforces it; the tool cannot escape it.

## Sandbox modes

| Mode | Network | Filesystem | Typical use |
|------|---------|------------|-------------|
| `none` | No access | No access | Pure computation tools |
| `restricted_local` | None | Declared paths only | Local file tools |
| `restricted_remote` | Allowlisted URLs only | None | HTTP fetch, web search |
| `privileged` | Full | Full | Shell command (always requires approval) |

Privileged mode is reserved for explicitly high-risk tools that always require human approval.

## Output limits

Tool output is capped to prevent:
- The model's context window being flooded with unwanted content
- Large data exfiltration disguised as tool output
- Resource exhaustion from unbounded output

Default cap: 65KB. Output exceeding the limit is truncated, and the truncation is noted in the execution record.

## What the sandbox doesn't cover

Sandboxing constrains the execution environment, but it doesn't eliminate the need for policy evaluation. A tool that is within its declared constraints can still be inappropriate in a given context (wrong user, wrong resource, policy violation).

Policy evaluation and sandboxing are complementary controls — both are needed.

## Related concepts

- [Tools](/docs/concepts/tools) — tool manifests and sandbox configuration
- [Security: Policy-First Architecture](/docs/security/policy-first) — authorization before execution
- [Security: Plugin Isolation](/docs/security/plugin-isolation) — plugin process isolation
