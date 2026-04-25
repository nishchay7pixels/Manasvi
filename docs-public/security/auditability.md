---
sidebar_position: 12
title: Auditability
description: How Manasvi provides a complete, tamper-evident record of all actions
---

# Auditability

## Why auditability is a security control

Audit trails are often thought of as a forensics tool — useful after something goes wrong. But auditability is also a preventive control: behaviors that would appear in the audit trail are less likely to occur, and systems that know they're being audited behave differently than systems that aren't.

In Manasvi, the audit trail is designed to be:

- **Complete** — every consequential event is recorded
- **Tamper-evident** — records cannot be silently modified after the fact
- **Navigable** — you can trace from any event to its full context

## What's recorded

### Every policy decision

```
{
  timestamp: "2024-01-15T10:23:45Z",
  decisionId: "pol-7f3a...",
  actor: { userId: "user-123", channel: "telegram" },
  tool: "tool.http-fetch",
  actionClass: "access-network",
  resource: "https://api.example.com/data",
  decision: "allow_with_approval",
  reasonCodes: ["action-class-requires-approval", "network-access"],
  policyVersion: "2024-01-10"
}
```

### Every approval event

The approval request, the reviewer's decision, and the resulting artifact — all with timestamps and actor identities.

### Every execution

```
{
  timestamp: "2024-01-15T10:24:02Z",
  executionId: "exec-9a2b...",
  intentId: "int-5c1d...",
  policyDecisionId: "pol-7f3a...",
  tool: "tool.http-fetch",
  parameters: { url: "https://api.example.com/data" },
  outcome: "success",
  outputSizeBytes: 4821,
  durationMs: 312
}
```

### Agent decisions

Each planning loop iteration, including what the model proposed and whether it was validated.

## Trace IDs

Every action carries a trace ID that links all related records. A single user message might produce:

- A planning loop entry
- A policy evaluation
- An approval request
- An approval event
- An execution record
- A tool output

All share the same trace ID. You can pull all records for a trace and reconstruct the complete history of what happened.

## Tamper-evidence

Audit records include a record hash that covers the record's content and the hash of the previous record. This creates a chain:

- Deleting a record breaks the chain (the next record's "previous hash" won't match)
- Modifying a record breaks its own hash
- Inserting a record is detectable because the sequence numbers and hashes won't align

## Querying the audit trail

The audit trail supports queries like:

- "All executions by user X in the last 7 days"
- "All policy denials for shell commands in the last month"
- "Full trace for conversation Y"
- "All actions that required and received approval"
- "All secret access events for secret Z"

## Retention

Audit records are retained for the duration configured by the operator. For compliance purposes, common retention windows are 90 days, 1 year, or 7 years depending on regulatory requirements.

## Related concepts

- [Architecture: Audit & Governance](/docs/architecture/audit-governance) — implementation details
- [Execution Intent](/docs/concepts/execution-intent) — the trace anchor
- [Security: Philosophy](/docs/security/philosophy) — why auditability is a first-class concern
