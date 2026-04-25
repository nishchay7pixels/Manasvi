---
sidebar_position: 9
title: Approvals
description: How human sign-off works for sensitive actions
---

# Approvals

## What is an approval?

An approval is a human decision to allow a specific action to proceed. When the policy service decides that an action requires sign-off, the agent pauses, sends an approval request, and waits.

Approvals exist because some actions are sensitive enough that no policy rule should automatically permit them — a human should always be in the loop.

## When approval is required

The policy service can require approval based on:

- **Tool risk level** — high-risk tools (like `tool.shell-command`) may always require approval
- **Resource sensitivity** — actions on specific files, endpoints, or data
- **Operator configuration** — you can require approval for any category of action
- **Context signals** — unusual patterns can trigger approval even for normally-allowed actions

## How approval works

1. The agent runtime proposes an action
2. Policy returns `allow_with_approval`
3. The runtime creates an **approval request** — a record of exactly what is being asked for
4. The approval request is sent to the configured approval channel (the same conversation, a separate admin channel, etc.)
5. A human reviews and approves or rejects
6. If approved, an **approval artifact** is issued — a cryptographically signed record of the approval
7. The runtime verifies the artifact and proceeds with execution

## Approval artifacts

An approval artifact is not just a flag in a database. It's a signed record that:

- **Names the exact action** — the approval is bound to a specific execution intent (by intent ID and payload hash)
- **Expires** — approvals have a time limit (default: 15 minutes). An old approval cannot authorize a new action
- **Cannot be transferred** — the signature covers the specific intent ID. An approval for one action cannot authorize a different one
- **Cannot be replayed** — once an approval artifact is consumed, it cannot be used again

This means if an attacker intercepts an approval response, they cannot use it to authorize a different action or replay it later.

## Approval channels

Approvals can be routed to different destinations:

- The same conversation where the request originated
- A dedicated admin channel
- An external system (via webhook)

The routing is configured by the operator and can vary by action type or risk level.

## Rejecting a request

If a human rejects an approval request, the agent is notified and can either:

- Explain to the user that the action was rejected
- Suggest an alternative approach that doesn't require the sensitive action
- Ask for clarification

A rejection is recorded in the audit trail along with the reason.

## Related concepts

- [Policies](/docs/concepts/policies) — how the approval requirement is determined
- [Execution Intent](/docs/concepts/execution-intent) — the artifact that links approval to action
- [Security: The Approval Primitive](/docs/security/approval-primitive) — the full security design
