---
sidebar_position: 6
title: Execution Manager
description: How tools are dispatched and run safely
---

# Execution Manager

## What it does

The execution manager receives signed execution intents from the orchestration plane and dispatches the corresponding tool actions to the sandbox runtime. It is the last checkpoint before anything actually happens.

## Responsibilities

- **Verify the intent** — check the cryptographic signature, expiration, and payload hash
- **Verify the approval** — if approval was required, check the approval artifact
- **Dispatch to sandbox** — send the tool action to the appropriate sandbox environment
- **Return the result** — collect the tool output and return it to the orchestrator
- **Record the outcome** — write the execution result to the audit trail

## Intent verification

Before executing anything, the execution manager independently verifies:

1. **Signature** — the intent's HMAC-SHA256 signature is valid, signed with the correct key
2. **Expiration** — the intent has not expired (default TTL: 15 minutes)
3. **Payload hash** — the parameters match the hash committed in the intent (prevents modification in transit)
4. **Idempotency** — the idempotency key hasn't been seen before (prevents duplicate execution)

If any check fails, the action is rejected. The execution manager does not trust that the orchestrator sent a valid intent — it verifies independently.

## Approval verification

For actions that required approval, the execution manager also verifies the approval artifact:

1. The approval artifact's signature is valid
2. The artifact's `intentId` matches the current intent
3. The artifact's `payloadHash` matches the current intent's payload hash
4. The artifact has not expired
5. The artifact's nonce has not been consumed before

This ensures the approval is for exactly this action, not a different one.

## Sandbox dispatch

Once verification passes, the execution manager dispatches the tool to the sandbox runtime. The sandbox:

- Enforces the network allowlist declared in the tool manifest
- Enforces the filesystem access constraints
- Caps output size (default: 65KB)
- Enforces execution time limits

The execution manager receives the result (or a timeout/error) and forwards it back to the orchestrator.

## Remote dispatch

For actions that should run on a remote node, the execution manager hands off to the **node manager** instead of the local sandbox. The node manager creates a signed dispatch request and routes it to the appropriate node agent.

## Error handling

If execution fails, the execution manager:

- Records the failure in the audit trail
- Returns a structured error to the orchestrator
- Does not retry automatically (retries are the orchestrator's decision)

## Related concepts

- [Execution Intent](/docs/concepts/execution-intent) — the artifact that authorizes execution
- [Tools](/docs/concepts/tools) — how tool sandboxing is configured
- [Architecture: Node Manager](/docs/architecture/node-manager) — remote execution dispatch
