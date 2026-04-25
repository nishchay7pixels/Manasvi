---
sidebar_position: 4
title: The Approval Primitive
description: How Manasvi makes human-in-the-loop guarantees cryptographically strong
---

# The Approval Primitive

## The problem with soft approvals

Many systems implement "human approval" by having someone click a button that sets a flag in a database. The problem is that this flag is just data — it can be forged, replayed, or misapplied to a different action than what was reviewed.

If an attacker can manipulate the approval state, or if a system bug applies an approval from one action to a different one, the "human approval" provides no real guarantee.

## Manasvi's approach: cryptographic binding

In Manasvi, an approval is not a flag. It's a **signed artifact** that is cryptographically bound to the specific action it approves.

### The binding chain

When an action requires approval:

1. An **execution intent** is created that describes exactly what will happen (tool, parameters, resource, expiry). The intent is signed and includes a **payload hash** — a fingerprint of the parameters.

2. An **approval request artifact** is created that includes the intent ID and payload hash. A human sees a description of the specific action.

3. When the human approves, a **signed approval artifact** is issued. It contains:
   - The intent ID being approved
   - The payload hash from that intent
   - An expiration time
   - A unique nonce

4. The execution manager verifies the approval artifact before executing. It checks:
   - The artifact's signature is valid
   - The `intentId` matches the current intent
   - The `payloadHash` matches the current intent's payload hash
   - The artifact has not expired
   - The nonce has not been consumed before

### What this prevents

**Approval for one action, applied to another**: If the payload hash doesn't match, the execution manager rejects the approval. An approval for "fetch this URL" cannot authorize "run this shell command."

**Replay attacks**: The nonce is consumed on first use. The same approval artifact cannot authorize two executions.

**Stale approvals**: The expiration time is cryptographically committed in the artifact. An old approval cannot authorize a new action.

**Forged approvals**: The approval artifact is HMAC-SHA256 signed. Without the signing key, you cannot produce a valid forged artifact.

## The human sees the right thing

The approval primitive only provides meaningful guarantees if the human reviewer sees an accurate description of what they're approving. Manasvi ensures this by:

- Generating the approval request description directly from the structured execution intent (not from free-form text)
- Showing the tool, parameters, resource, and expiry in a structured format
- Not allowing the model to craft its own approval request text

The description is derived from the same data that is cryptographically committed in the intent. What you see is what you're approving.

## Related concepts

- [Approvals](/docs/concepts/approvals) — the concept overview
- [Execution Intent](/docs/concepts/execution-intent) — the artifact the approval is bound to
- [Architecture: Approval Flow](/docs/architecture/approval-flow) — implementation details
