---
sidebar_position: 19
title: Google Permissions and Policy
description: Understand connected vs authorized for Google integrations in Manasvi
---

# Google Permissions and Policy

Manasvi treats Google integration as governed capability, not ambient access.

## Connected vs authorized

- **Connected**: OAuth completed and token state exists.
- **Authorized**: required scopes and capabilities exist for a specific action.
- **Allowed**: policy decision permits the action for the requesting principal.
- **Approval required**: policy or action sensitivity requires a human approval step.
- **Denied**: missing connection, missing scope/capability, or policy denial.

## Scope, capability, action model

- **Provider scopes**: Google OAuth scope strings.
- **Normalized scopes**: internal stable names (for operator/policy clarity).
- **Capabilities**: Manasvi semantics (for example `gmail.send`, `calendar.write_events`).
- **Actions**: policy-evaluable operations (for example `gmail.message.send`).

## Read vs write classification

Google actions are classified as:

- `read`
- `write`
- `communication_write`
- `sharing_write`
- `destructive_write` (reserved for future destructive operations)

Classification is visible to policy and operator surfaces.

## Approval sensitivity

Each action has explicit sensitivity:

- `none`
- `policy`
- `required`

Example: `gmail.message.send` is marked `required` in G2.

## Operator commands

```bash
pnpm manasvi integrations status
pnpm manasvi integrations check gmail.threads.read
pnpm manasvi integrations check gmail.message.send
```

Dashboard: **Integrations** page shows capabilities, action matrix, missing capabilities, and live permission checks.

## Troubleshooting

- `CONNECTOR_NOT_CONNECTED`: run `pnpm manasvi integrations add google`.
- `MISSING_REQUIRED_SCOPE_OR_CAPABILITY`: reconnect with required scopes for target action family.
- `POLICY_CLIENT_UNAVAILABLE`: verify policy service is running and reachable from api-gateway.
- decision `require_approval`: action is policy-gated or sensitivity-marked.
