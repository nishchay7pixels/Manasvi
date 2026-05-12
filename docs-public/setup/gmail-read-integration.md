---
sidebar_position: 20
title: Gmail Read Integration
description: Use Manasvi to safely read Gmail with policy enforcement and provenance
---

# Gmail Read Integration

Milestone G3 enables Gmail read workflows on top of the Google integration foundation (G1) and permission layer (G2).

## What this enables

- Gmail connector health/readiness checks
- List inbox messages
- Search messages with bounded results
- Inspect threads
- Read normalized message content
- Attachment metadata access (filename/mime/size/id)
- Provenance-aware ingestion records for email-derived content

## What this does not enable yet

- Sending email
- Drafting replies
- Archive/delete/move/label mutations
- Any Gmail write-side mailbox mutation

## Read-only safety model

- Gmail operations are read-only API calls.
- Every read path is permission-checked through G2 policy binding.
- Content is labeled `EXTERNAL_UNTRUSTED` with source provenance.
- Tokens are not exposed in CLI/dashboard responses.

## CLI usage

```bash
pnpm manasvi integrations gmail-health
pnpm manasvi integrations gmail-attention
```

For policy checks by action:

```bash
pnpm manasvi integrations check gmail.threads.read
```

## API usage (operator/dev)

- `GET /integrations/google/gmail/health`
- `POST /integrations/google/gmail/messages/list`
- `POST /integrations/google/gmail/messages/search`
- `POST /integrations/google/gmail/threads/list`
- `GET /integrations/google/gmail/messages/:messageId`
- `GET /integrations/google/gmail/threads/:threadId`
- `POST /integrations/google/gmail/attention`

## Questions this supports

- "What emails need my attention?"
- "Show unread messages from this week"
- "Find messages about invoice reconciliation"
- "Summarize the latest thread with vendor X"

## Troubleshooting

- `CONNECTOR_NOT_CONNECTED`: run `pnpm manasvi integrations add google`.
- `MISSING_REQUIRED_SCOPE_OR_CAPABILITY`: reconnect with Gmail read scope.
- `POLICY_CLIENT_UNAVAILABLE`: ensure policy service is reachable.
- `require_approval`: policy is configured to gate this action.
