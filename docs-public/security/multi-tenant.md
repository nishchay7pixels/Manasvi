---
sidebar_position: 11
title: Multi-Tenant Isolation
description: How Manasvi isolates different users and contexts
---

# Multi-Tenant Isolation

## What multi-tenancy means here

In Manasvi, multiple users interact with the system simultaneously, potentially through different channels. Multi-tenant isolation ensures that:

- One user's data doesn't leak to another user's session
- One user's actions don't affect another user's permissions or state
- Compromising one user's session doesn't compromise others

## Session isolation

Each conversation runs in its own session. Sessions are scoped to:

- A specific actor (user identity)
- A specific channel (Telegram, Slack, API)
- A specific conversation ID

Memory retrieved for one session is scoped to that session. A user's personal notes are not visible in another user's session.

## Actor identity and policy

Every action is authorized in the context of a specific actor. Policy rules can be per-actor, per-channel, or per-role. This means:

- User A having permission to approve their own file reads doesn't give User B that permission
- An admin on the Slack channel doesn't automatically have admin permissions through the API channel
- Permissions granted in one session don't carry over to another session for a different user

## Memory boundaries

The memory plane enforces boundaries between tenants:

- Per-user trusted store: User A's notes are not visible to User B
- Session-scoped working store: cleared when the session ends, not shared between users
- Core store: shared, but read-only for all non-operators (operator instructions apply to all users equally)

## Operator-controlled tenancy

Tenancy is defined and managed by the operator. For each deployment, the operator configures:

- How user identities are established (Telegram user ID, Slack user ID, API key)
- What trust level each identity class carries
- Whether users share any resources (e.g., a shared memory space for team knowledge)

## Audit trail per tenant

The audit trail records the actor for every event. This means you can filter the audit trail by user and see exactly what each user's sessions did, without mixing records from other users.

## Related concepts

- [Sessions](/docs/concepts/sessions) — how conversations are scoped
- [Memory](/docs/concepts/memory) — trust-classified memory stores
- [Policies](/docs/concepts/policies) — per-actor authorization rules
