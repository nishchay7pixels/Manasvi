# Gmail Write Actions

Manasvi can compose drafts, create reply drafts, send email, archive messages, and apply or remove labels — all governed by the same policy and approval system that controls every other action.

## Prerequisites

- Google integration connected with write scopes (see [Connect Google](connect-google.md))
- Services running (`pnpm manasvi start`)

## Scope upgrade

Read-only Google connections only grant `gmail.readonly`. Write actions require additional OAuth scopes. Reconnect with write mode to request them:

```sh
pnpm manasvi integrations add google write
```

This requests:
- `gmail.readonly` — read access (already present)
- `gmail.compose` — create and edit drafts
- `gmail.send` — send email on your behalf
- `gmail.modify` — archive messages, apply and remove labels

After reconnecting, verify write capability status:

```sh
pnpm manasvi integrations gmail-write-status
```

## Drafting vs. sending

Manasvi treats drafting and sending as separate, governed actions with different approval requirements.

| Action | Capability | Approval |
|--------|-----------|---------|
| Create draft | `gmail.compose` | may require (policy) |
| Create reply draft | `gmail.compose` | may require (policy) |
| **Send message** | `gmail.send` | **always required** |
| Archive message | `gmail.modify` | may require (policy) |
| Apply/remove labels | `gmail.modify` | may require (policy) |

**Send always requires explicit approval.** There is no configuration that bypasses the approval gate for `gmail.message.send`. When the agent composes a send action, it is held in the approval queue until an operator approves or denies it.

## Approval flow

When the agent proposes sending an email:

1. The action is submitted to the approval service and held as `pending`.
2. An approval request appears in the admin dashboard under **Approvals**.
3. The operator reviews the recipient, subject, and content summary, then approves or denies.
4. On approval, the execution manager delivers the approved intent back to the agent, which completes the send.
5. The send is recorded in the audit trail with the approving operator's identity.

If the approval expires or is denied, the agent receives a structured rejection and no email is sent.

## Checking write capability status

```sh
# CLI — shows AVAILABLE / MISSING SCOPE for each write capability
pnpm manasvi integrations gmail-write-status

# Also available in the admin dashboard:
# Integrations → Gmail Write Capabilities
```

## Policy rules

The default policy set ships with rules that:

- Allow draft creation (priority 680 — class `write`, service endpoint)
- Require approval for sending (priority 750 — class `external-side-effect`)
- Allow archive and label operations (priority 681 — class `write`)

Operators can tighten these rules by adding custom deny or require-approval rules at higher priority in their policy set.

## Audit trail

Every write action — including failures and approval decisions — is recorded in the audit service with:

- Action ID and service family
- Actor and caller principals
- Outcome (created / sent / archived / denied)
- Approval request ID (for send actions)
- Timestamp

Content (email body, recipients) is not stored in the audit log. The audit record contains structural metadata only.

## Reconnecting to upgrade scopes

If write capabilities show as `MISSING SCOPE`, the token predates the write scope grant. Reconnect:

```sh
pnpm manasvi integrations add google write
# Open the printed URL in a browser and approve the additional scopes
```

The existing read token is replaced. Read access continues to work after reconnection.
