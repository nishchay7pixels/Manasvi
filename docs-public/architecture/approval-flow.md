---
sidebar_position: 5
title: Approval Flow
description: How sensitive actions get human sign-off
---

# Approval Flow

## What it does

The approval flow handles the pause-and-wait lifecycle when a sensitive action requires human confirmation before it can proceed.

When policy returns `allow_with_approval`, execution does not proceed automatically. The approval flow takes over: it packages the request, routes it to a human reviewer, and waits for an authenticated response before returning control to the agent runtime.

## The approval lifecycle

```
policy: allow_with_approval
         │
         ▼
[Create approval request artifact]
         │
         ▼
[Sign artifact — bind to intent ID + payload hash]
         │
         ▼
[Route to reviewer — same channel, admin channel, or webhook]
         │
         ▼
[Wait for response]
         │
    ┌────┴────┐
    │         │
  approve   reject
    │         │
    ▼         ▼
[Issue     [Notify agent —
 signed     action rejected]
 approval
 artifact]
    │
    ▼
[Resume agent runtime with artifact]
```

## Approval request artifact

An approval request isn't just a notification — it's a structured artifact that:

- Contains the full description of what is being requested
- Names the specific execution intent it relates to (by intent ID and payload hash)
- Is signed so it can't be tampered with
- Expires after a configurable window (default: 15 minutes)

The human reviewer sees a clear description of the proposed action and can approve or reject with confidence that they're responding to exactly what was described.

## Approval response artifact

When a reviewer approves, the approval flow issues a **signed approval artifact**:

- Cryptographically signed
- Bound to the specific execution intent (cannot be used for a different action)
- Time-limited (the approval expires)
- Carries a unique nonce (cannot be replayed)

The execution manager verifies this artifact independently before allowing execution to proceed.

## Routing configuration

Approval requests can be routed to:

- **Same conversation** — the user who initiated the action sees the request inline
- **Admin channel** — a separate channel where a different person must approve
- **Webhook** — an external system receives the request and can respond programmatically

Routing is configured per action type or risk level. A shell command might go to an admin channel; a file read might be approvable inline.

## Timeout and rejection

If no response is received within the approval window:

- The approval request expires
- The agent runtime is notified that the approval timed out
- The action is not executed

If explicitly rejected:
- The rejection is recorded in the audit trail
- The agent runtime receives a rejection response
- The agent can inform the user and suggest alternatives

## Related concepts

- [Approvals](/docs/concepts/approvals) — the concept overview
- [Execution Intent](/docs/concepts/execution-intent) — the artifact the approval is bound to
- [Security: The Approval Primitive](/docs/security/approval-primitive) — security properties
