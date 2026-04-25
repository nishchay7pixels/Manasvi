---
sidebar_position: 8
title: Policies
description: How Manasvi decides what actions are allowed
---

# Policies

## What is a policy?

A policy is a rule that determines whether an action is allowed. In Manasvi, no tool can be used and no side effect can occur without a policy decision saying it's permitted.

Policies answer the question: **given who is asking, what they want to do, and the current context — should this be allowed?**

## The policy decision

When the agent runtime proposes an action, it sends a **policy evaluation request** to the policy service. The service evaluates the request and returns one of three decisions:

| Decision | Meaning |
|----------|---------|
| `allow` | The action is permitted — proceed |
| `allow_with_approval` | The action is permitted but requires human sign-off first |
| `deny` | The action is not permitted |

The policy service also returns **reason codes** — short labels that explain why a decision was made. These are recorded in the audit trail for every action.

## What policies evaluate

A policy decision considers:

- **Actor identity** — who is making the request
- **Tool identity** — which tool is being called
- **Action class** — the category of action (read, write, network, shell, etc.)
- **Resource** — what specific resource is being acted on
- **Risk level** — how sensitive the tool or action is
- **Channel** — what ingress channel the request came through
- **Time and context** — time of day, session state, recent actions

## Policy layers

Policies can be configured at multiple layers:

1. **System defaults** — built-in rules that apply everywhere (e.g., shell commands always require approval)
2. **Operator policy** — rules configured for your deployment (e.g., restrict network access to an allowlist)
3. **User policy** — per-user rules (e.g., this user can approve their own file reads)

Layers are evaluated in order. A `deny` at any layer cannot be overridden by a lower layer.

## Fail-closed design

The policy service is **fail-closed**: if it cannot evaluate a request (because of an error, timeout, or missing configuration), the decision is `deny`. The agent runtime treats a missing or failed policy decision as a denial.

This means the system defaults to safe behavior when something goes wrong — actions aren't accidentally permitted because the policy check failed.

## Policy and approvals

Some actions require approval even if policy permits them. This is configured in the policy rules: a decision of `allow_with_approval` tells the runtime to pause, create an approval request, and wait for a human to confirm before proceeding.

The approval is cryptographically linked to the specific action — it cannot be transferred or replayed for a different request.

## Related concepts

- [Approvals](/docs/concepts/approvals) — how human sign-off works
- [Execution Intent](/docs/concepts/execution-intent) — the authorization artifact issued after a policy allows
- [Security: Policy-First Design](/docs/security/policy-first) — the design philosophy
