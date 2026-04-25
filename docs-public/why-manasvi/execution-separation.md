---
sidebar_position: 3
title: Execution Separation
description: Why Manasvi separates thinking from acting
---

# Execution Separation

## The problem with direct execution

In most agent frameworks, when the model decides to call a tool, the call happens. The model's output is the execution instruction.

This creates a direct connection between model output and real-world effects. Whatever influences the model's output — including injected instructions in retrieved content — can directly cause actions.

## The Manasvi model: think, authorize, act

Manasvi inserts an explicit separation between the model's reasoning phase and the execution phase:

```
Model output (text)
      │
      ▼
Proposal parsing
(structured representation of what the model wants)
      │
      ▼
Validation
(is this a legitimate proposal? any suspicious claims?)
      │
      ▼
Policy evaluation
(is this authorized for this actor in this context?)
      │
      ▼
[Optional: human approval]
      │
      ▼
Signed execution intent
(time-limited, tamper-proof authorization artifact)
      │
      ▼
Execution manager
(independent verification before dispatch)
      │
      ▼
Sandbox execution
(constrained environment, declared resources only)
```

The model cannot skip any of these steps. It proposes; the system decides whether and how to act.

## Why signed intents

The execution intent isn't just a signal from the orchestrator saying "proceed." It's a cryptographically signed artifact that the execution manager verifies independently.

This matters because the execution manager doesn't need to trust that the orchestrator made the right call — it can verify that the authorization is cryptographically valid, unexpired, and matches the parameters of the action being requested.

If the execution manager receives a fraudulent intent (say, an attacker somehow injected one), the HMAC-SHA256 signature will fail verification and the action will be rejected.

## Why sandboxed execution

Even after all the authorization steps, the tool runs in a sandbox. The sandbox enforces the tool's declared constraints regardless of what the model or the orchestrator said:

- Network access is restricted to declared allowlists
- Filesystem access is restricted to declared paths
- Output is bounded

This means if something went wrong in the authorization chain — a bug, a misconfiguration, an edge case — the sandbox provides a last line of containment. The tool cannot exceed its declared scope even if somehow authorized to try.

## The result

Execution separation means that each layer only needs to trust its immediate inputs, not the entire chain above it:

- The proposal parser only needs to parse well-formed text
- The validator only needs to check structural properties
- Policy only needs to evaluate the request
- The execution manager only needs to verify the intent signature
- The sandbox only needs to enforce declared constraints

No single component bears the full security burden. Defense in depth.

## Related pages

- [Execution Intent](/docs/concepts/execution-intent) — the signed authorization artifact
- [Security: Zero Trust Design](/docs/security/zero-trust) — how each component verifies independently
- [Security: Sandboxed Execution](/docs/security/sandboxed-execution) — execution constraints
