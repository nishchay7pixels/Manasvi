---
sidebar_position: 2
title: Zero Trust Design
description: Why Manasvi trusts nothing by default
---

# Zero Trust Design

## What zero trust means here

In Manasvi, "zero trust" means that no component automatically trusts another component's claims — even internal components. Every consequential action requires independent verification at the point of execution.

This is not about network perimeters. It's about what happens when a service says "I authorized this" — the receiving service doesn't just believe it. It checks.

## What each component verifies independently

### Execution Manager

When the orchestrator sends a signed execution intent to the execution manager, the execution manager does not assume the intent is valid because the orchestrator sent it. It independently verifies:

- The HMAC-SHA256 signature (using its own copy of the key)
- The intent's expiration time (not expired)
- The payload hash (parameters haven't been modified in transit)
- The idempotency key (not a duplicate execution)

### Node Agent

When the node manager sends a dispatch request to a node agent, the node agent does not assume the dispatch is legitimate because it came from the node manager's address. It independently verifies:

- The dispatch nonce (not previously seen — replay protection)
- The dispatch payload hash (the request hasn't been modified)
- The approval artifact (if included)

### Approval Service

When the orchestrator presents an execution intent for approval processing, the approval service verifies the intent's signature before accepting the request. It doesn't trust that the orchestrator's claim of "this action needs approval" is well-formed — it checks.

## Why this matters

The zero-trust verification chain means that a compromise of one internal component does not automatically compromise the others.

If an attacker compromises the orchestrator and tries to issue a fraudulent execution intent, the execution manager will reject it — because the attacker doesn't have the signing key, so the signature verification fails.

If an attacker intercepts a dispatch request and tries to replay it to a different node or with modified parameters, the node agent will reject it — the dispatch nonce is already consumed, or the payload hash won't match.

## Trust levels in practice

Zero trust doesn't mean all components are treated identically. It means:

- **Higher-trust components** are given more authority in policy rules
- But their authority is still verified cryptographically, not just assumed
- And authority is bounded — even high-trust components cannot override hard denials

An operator's instruction in the core memory store carries high trust — but it still cannot override a hard-coded denial for a category of action.

## Related concepts

- [Execution Intent](/docs/concepts/execution-intent) — the signed artifact at the center of verification
- [Security: Replay and Tampering Resistance](/docs/security/replay-tampering) — the full verification chain
- [Security: Philosophy](/docs/security/philosophy) — the principles behind this design
