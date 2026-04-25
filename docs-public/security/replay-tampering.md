---
sidebar_position: 10
title: Replay and Tampering Resistance
description: How Manasvi prevents reuse and modification of authorization artifacts
---

# Replay and Tampering Resistance

## The attacks

**Replay attack**: An attacker captures a valid authorization artifact (an approval, a dispatch request) and reuses it to authorize a different or duplicate action.

**Tampering attack**: An attacker intercepts an authorization artifact and modifies its parameters (change the URL, change the node ID, change the expiry) before it reaches the verifier.

These attacks are particularly relevant to AI systems because authorization artifacts pass through multiple services and may traverse untrusted networks.

## Defense: execution intents

Every authorized action is represented as a **signed execution intent** containing:

- A cryptographic signature (HMAC-SHA256) over all intent fields
- A **payload hash** — a SHA-256 fingerprint of the action parameters
- An expiration time
- An idempotency key

**Against tampering**: Changing any field in the intent — including the parameters — changes the payload hash. The execution manager recomputes the expected hash and rejects any request where they don't match. Changing the signature field directly is impossible without the signing key.

**Against replay**: The idempotency key is recorded on first successful execution. A duplicate intent with the same idempotency key is recognized and rejected.

**Against stale reuse**: The expiration time is part of the signed payload. An expired intent cannot be used to authorize execution.

## Defense: approval artifacts

Approval artifacts include:

- A cryptographic signature
- The specific intent ID and payload hash they approve
- An expiration time
- A **nonce** — a unique one-time value

**Against transfer**: The approval artifact names the specific intent ID and payload hash. An approval for "fetch URL A" cannot authorize "fetch URL B" — the payload hashes differ.

**Against replay**: The nonce is consumed on first use. The same approval artifact cannot authorize two executions.

**Against stale reuse**: Approval artifacts expire independently of the intent (default: 15 minutes).

**Against forgery**: The signature covers the nonce as a committed field. Swapping the nonce in a captured artifact without recalculating the HMAC produces an invalid signature.

## Defense: dispatch artifacts

Remote dispatch requests (node-to-node) include:

- A **dispatch nonce** — a unique one-time value generated per dispatch
- A **dispatch payload hash** — covering the intent payload hash, artifact ID, node ID, dispatch ID, and expiry

**Against replay**: The node agent records all consumed dispatch nonces. A repeated dispatch nonce is rejected with `DISPATCH_NONCE_REPLAYED`.

**Against redirection**: The node ID is covered by the payload hash. A dispatch intended for node A cannot be redirected to node B — the hash would be invalid.

**Against parameter modification**: Any change to the dispatch parameters invalidates the payload hash.

## The verification chain

```
Orchestrator issues execution intent
         │  (HMAC-SHA256 signature + payload hash + expiry + idempotency)
         ▼
Execution Manager verifies intent
         │  (checks signature, hash, expiry, idempotency)
         ▼
[if approval required] Verifies approval artifact
         │  (checks signature, intentId match, hash match, expiry, nonce)
         ▼
[if remote dispatch] Node Manager creates dispatch artifact
         │  (dispatch nonce + dispatch payload hash)
         ▼
Node Agent verifies dispatch artifact
         │  (checks nonce not seen, hash matches)
         ▼
Execution proceeds
```

Each step verifies independently. Compromise of one step does not compromise the others.

## Related concepts

- [Execution Intent](/docs/concepts/execution-intent) — the signed authorization artifact
- [Approvals](/docs/concepts/approvals) — approval artifact lifecycle
- [Nodes](/docs/concepts/nodes) — node dispatch security
- [Security: Zero Trust Design](/docs/security/zero-trust) — why each component verifies independently
