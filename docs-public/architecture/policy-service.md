---
sidebar_position: 4
title: Policy Service
description: How the policy service evaluates and enforces authorization rules
---

# Policy Service

## What it does

The policy service is the authorization authority in Manasvi. Every proposed action — every tool call, every side effect — must be evaluated by the policy service before it can proceed.

The service takes in a description of the proposed action and its context, evaluates it against configured rules, and returns a decision.

## Policy evaluation request

When the agent runtime wants to authorize an action, it sends a policy evaluation request containing:

- **Actor** — who is making the request (user ID, trust level, channel)
- **Tool** — which tool is being called
- **Action class** — the category (read, write, network access, shell execution, etc.)
- **Resource** — what specific resource is targeted
- **Parameters** — the full parameters of the proposed action
- **Session context** — current session state, previous approvals in this conversation

## Policy decision

The service returns:

```typescript
{
  decision: "allow" | "allow_with_approval" | "deny",
  decisionId: string,        // unique ID recorded in audit trail
  reasonCodes: string[],     // why this decision was made
  requiredApprovalLevel: string | null
}
```

The `decisionId` is embedded in the execution intent that's issued after an `allow` decision. This creates an unbreakable link between the authorization decision and the action that was executed.

## Policy rule layers

Rules are evaluated in priority order:

1. **Hard denials** — actions that can never be permitted regardless of configuration
2. **System defaults** — built-in rules for known risk levels
3. **Operator rules** — deployment-specific configuration
4. **User rules** — per-user permissions

A `deny` at any layer is final. A lower-priority layer cannot override a higher-priority denial.

## Fail-closed behavior

The policy service is designed to fail safely:

- If the service is unreachable, the default decision is `deny`
- If a rule evaluation throws an error, the default decision is `deny`
- If required context is missing, the default decision is `deny`

The agent runtime treats any failure to obtain a valid policy decision as a denial and will not proceed with the action.

## Audit integration

Every policy decision is recorded in the audit trail with:

- The full request parameters (redacted for sensitive fields)
- The decision and all reason codes
- The timestamp
- The evaluating policy version

This means you can always reconstruct exactly why any action was authorized or denied.

## Related concepts

- [Policies](/docs/concepts/policies) — high-level policy concept overview
- [Execution Intent](/docs/concepts/execution-intent) — the artifact issued after an `allow` decision
- [Architecture: Orchestration Plane](/docs/architecture/orchestration-plane) — where the policy service fits
