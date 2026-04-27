---
sidebar_position: 1
title: Architecture Overview
description: How Manasvi's components fit together
---

# Architecture Overview

Manasvi is built as a set of cooperating services, each with a narrow responsibility. No single component has unchecked authority — decisions are made by the right service, verified by the next one in the chain.

## System diagram

```
Ingress Plane
┌──────────────────────────────────────┐
│  Telegram  │  Slack  │  API Gateway  │
└──────────────────┬───────────────────┘
                   │ normalized message
                   ▼
         Orchestration Plane
┌──────────────────────────────────────┐
│           Agent Runtime              │
│  (planning loop, proposal parsing,   │
│   prompt injection detection)        │
│                  │                   │
│         Policy Service               │
│  (allow / allow_with_approval / deny)│
│                  │                   │
│        Approval Flow                 │
│  (optional human sign-off)           │
└──────────────────┬───────────────────┘
                   │ signed execution intent
                   ▼
         Execution Plane
┌──────────────────────────────────────┐
│        Execution Manager             │
│  (intent verification, dispatch)     │
│                  │                   │
│         Sandbox Runtime              │
│  (network + filesystem constraints)  │
└──────────────────┬───────────────────┘
                   │  (optional remote dispatch)
                   ▼
         Node Plane
┌──────────────────────────────────────┐
│  Node Manager  │  Node Agent(s)      │
│  (dispatch signing, nonce tracking)  │
└──────────────────────────────────────┘

Supporting Planes
┌──────────────┐  ┌────────────────┐  ┌──────────────────┐
│ Memory Plane │  │ Extension Plane│  │  Audit & Logging │
│ (trust-      │  │ (plugins,      │  │  (immutable trail│
│  classified  │  │  tool registry)│  │   of all actions)│
│  stores)     │  │                │  │                  │
└──────────────┘  └────────────────┘  └──────────────────┘
```

## Planes

Manasvi's architecture is organized into logical **planes** — groups of components with related responsibilities:

| Plane | Responsibility |
|-------|---------------|
| **Ingress** | Accept messages from external channels, normalize into internal format |
| **Orchestration** | Think, plan, authorize — the governance layer |
| **Execution** | Run tools safely within declared constraints |
| **Node** | Dispatch workloads to remote execution environments |
| **Memory** | Store and retrieve context, organized by trust level |
| **Extension** | Plugin lifecycle and tool registry |
| **Audit** | Record everything for accountability |

## Security flow

Every consequential action flows through the same verification chain:

1. **Agent runtime** — parses model output into a structured proposal
2. **Policy service** — decides allow/deny/approve
3. **Approval flow** — if required, waits for human sign-off
4. **Intent issuance** — creates a signed, time-limited execution intent
5. **Execution manager** — verifies the intent before dispatching
6. **Sandbox** — enforces declared constraints during execution
7. **Node agent** — re-verifies if dispatched to a remote node

No step trusts the previous step's claim — each verifies independently.

## Design principles

- **Separation of concerns** — each plane has a narrow, well-defined job
- **Fail-closed** — uncertainty defaults to denial, not permission
- **Signed artifacts** — authorization is cryptographic, not assumed
- **Auditable** — every decision and action is recorded

## Built-in tool layer

Manasvi ships with a governed built-in toolset that gives it immediate practical utility:

| Tool | Purpose | Risk |
|---|---|---|
| `tool.local-file-read` | Read local files in sandbox | Low |
| `tool.http-fetch` | Fetch remote content under egress policy | Medium |
| `tool.web-search` | Web search with structured results | Medium |
| `tool.memory-note-write` | Write notes to governed memory | Medium |
| `tool.approval-request` | Route actions to human reviewers | High |
| `tool.shell-command` | Bounded shell execution (approval required) | High |

Every tool invocation flows through the same security chain: policy → intent signing → sandboxed execution → output validation. Tool results carry explicit trust classification and provenance.

→ [Built-in tools overview](/docs/tools/overview)
→ [Default tool sets](/docs/tools/default-sets)

## Related pages

- [Ingress Plane](/docs/architecture/ingress-plane)
- [Orchestration Plane](/docs/architecture/orchestration-plane)
- [Policy Service](/docs/architecture/policy-service)
- [Execution Manager](/docs/architecture/execution-manager)
- [Node Manager](/docs/architecture/node-manager)
- [Built-in Tools](/docs/tools/overview)
