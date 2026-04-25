---
sidebar_position: 3
title: Policy-First Architecture
description: Why every action is gated by an explicit authorization decision
---

# Policy-First Architecture

## What policy-first means

In Manasvi, no tool can be used and no side effect can occur unless a policy decision explicitly permits it. There is no default-allow path. There is no "small action" that bypasses authorization.

The policy evaluation is not a filter applied after the fact — it is the gate through which all action proposals must pass before an execution intent is issued.

## How other frameworks approach this

Most agent frameworks operate on an implicit model: the developer configures which tools the agent can use, and then the agent can use those tools freely. There's no runtime authorization layer.

This creates a problem: if the developer's configuration is wrong (too permissive, or doesn't anticipate edge cases), there's no safety net. If the model is manipulated into requesting a tool action outside the intended scope, there's no independent check.

## The Manasvi model

```
Model proposes action
         │
         ▼
Policy evaluation
(Who is asking? What tool? What resource?
 What action class? What channel? What context?)
         │
    ┌────┴────────────────┐
    │                     │
  allow              allow_with_approval       deny
    │                     │                    │
    ▼                     ▼                    ▼
Issue signed         Pause, get         Reject — no
execution intent     human approval     execution intent
                     then issue intent
```

Policy is evaluated for every proposal. There is no tool that skips evaluation. There is no user who bypasses the policy service.

## Why explicit authorization

Explicit authorization has several properties that implicit configuration doesn't:

**Reason codes** — every decision explains itself. You can ask "why was this allowed?" or "why was this denied?" and get a specific answer.

**Audit integration** — the policy decision ID is embedded in the execution intent and recorded in the audit trail. You can trace from any execution back to the specific authorization decision.

**Context awareness** — policy can consider runtime context (what channel is this? what has already been approved this session?) not just static configuration.

**Fail-closed** — if the policy service is unavailable, the decision is deny. Static configuration doesn't have this property — an unavailable configuration store might fail open.

## Configuring policies

Policy rules are configured per deployment. You can define:

- Which tools require approval (by tool ID, action class, or risk level)
- Which users or channels have elevated permissions
- Which resources are off-limits regardless of other rules
- Time-based rules (e.g., certain actions require approval outside business hours)

## Related concepts

- [Policies](/docs/concepts/policies) — the policy concept
- [Architecture: Policy Service](/docs/architecture/policy-service) — implementation details
- [Security: Zero Trust Design](/docs/security/zero-trust) — the broader trust model
