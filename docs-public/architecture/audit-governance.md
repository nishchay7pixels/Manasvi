---
sidebar_position: 10
title: Audit & Governance
description: How Manasvi records and preserves accountability
---

# Audit & Governance

## What it does

The audit system records a complete, tamper-evident trail of everything that happens in Manasvi — every policy decision, every approval, every tool execution, and every outcome.

This isn't just logging. The audit trail is a governance artifact: a record that can answer the question "exactly what did the AI do, why was it authorized, and what was the result?"

## What's recorded

### Policy decisions

Every policy evaluation is recorded:

- The full request (actor, tool, action class, resource)
- The decision (`allow`, `allow_with_approval`, `deny`)
- All reason codes
- The timestamp and policy version

### Approval events

Every approval request, approval, and rejection is recorded:

- The approval request artifact
- The reviewer's decision and timestamp
- The resulting approval artifact (if approved)

### Execution events

Every tool execution is recorded:

- The execution intent (including signature and payload hash)
- The tool invoked, with parameters
- The outcome (success, failure, timeout)
- The output size
- The wall-clock duration

### Agent decisions

The agent runtime records:

- Each planning loop iteration
- Model proposals (structured form, not raw text)
- Validation results
- Intent IDs for all issued intents

## Trace linking

Every action has a **trace ID** that links all related records together. You can take any execution event and trace back through:

- The execution intent that authorized it
- The policy decision that approved it
- The approval artifact (if required)
- The agent runtime iteration that proposed it
- The user message that initiated the conversation

This chain of custody is complete and unambiguous.

## Immutability

Audit records are written once and not modified. The audit system is append-only by design. Records include:

- A monotonic sequence number
- The timestamp of creation
- A record hash (for integrity checking)

## Retention and export

Audit records are retained per your configured retention policy. They can be exported for:

- Compliance reporting
- Post-incident analysis
- Integration with external SIEM systems

## Governance use cases

The audit trail supports:

- **Incident investigation** — "What exactly did the AI do when this happened?"
- **Compliance demonstration** — "Show me every time a sensitive action was executed this month"
- **Policy tuning** — "What actions are most frequently denied? What should we change?"
- **Approval review** — "Who approved this action? What did they see?"

## Related concepts

- [Security: Auditability](/docs/security/auditability) — the full audit model
- [Execution Intent](/docs/concepts/execution-intent) — the trace anchor for every action
