---
sidebar_position: 3
title: Execution Intent
description: The signed artifact that authorizes and governs tool execution
---

# Execution Intent

## What is an execution intent?

An execution intent is a **cryptographically signed record** that represents authorization to execute a specific action. Before any tool or side effect can happen in Manasvi, there must be a valid execution intent.

Think of it like a **work order** that has been:
- Signed by an authorized issuer (the orchestrator)
- Stamped with a time limit (it expires)
- Bound to a specific action and parameters (it can't be repurposed)
- Sealed against modification (any change breaks the signature)

## What does it contain?

An execution intent includes:

- **Who is requesting the action** (the actor — a user or agent)
- **What service is authorizing it** (the orchestrator)
- **What action is being authorized** (tool ID, action class, parameters)
- **What resource it targets** (a specific endpoint, file, or resource)
- **The policy decision** that approved it (decision ID, reason codes)
- **A cryptographic signature** over all the above
- **An expiration time** (default: 15 minutes)
- **A payload hash** — a fingerprint of the parameters that prevents modification
- **A trace ID** — for linking this action to the full audit trail
- **An idempotency key** — to prevent duplicate executions

## Why does it need a signature?

Without a signature, the execution manager would have to trust that the orchestrator's claimed approval is real. With a signature, it can verify independently — even if the message passes through untrusted channels or is somehow intercepted, the signature reveals any tampering.

**Payload hashing** is especially important: the parameters of the action are hashed and included in the intent. If anything changes — even a single character in a URL or filename — the hash changes, and execution is rejected.

## Why does it expire?

Intents expire to prevent **replay attacks** — situations where someone saves a valid authorization and reuses it later. A valid intent from 20 minutes ago should not be able to authorize execution now.

Default expiration is 15 minutes for most actions. You can configure this per your needs.

## How does the approval connect?

When an action requires human approval, the approval artifact is cryptographically linked to the execution intent:

1. The approval artifact records **exactly which intent it is approving** (via the intent ID and payload hash)
2. The approval artifact has its own expiration
3. When execution is attempted, the execution manager verifies that the approval artifact matches this specific intent and hasn't expired

This means approvals cannot be transferred to a different action, used after expiration, or replayed.

## Who verifies intents?

Every service that does something consequential verifies execution intents:

- **Approval service** — checks the intent signature before accepting an approval request
- **Execution manager** — checks the intent signature, payload hash, expiration, and approval linkage before executing
- **Node agent** — checks everything again before running workloads on remote nodes

## Related concepts

- [Approvals](/docs/concepts/approvals) — when and how human approval is required
- [Policies](/docs/concepts/policies) — how the authorization decision is made
- [Security: Replay and Tampering Resistance](/docs/security/replay-tampering) — the full security model
