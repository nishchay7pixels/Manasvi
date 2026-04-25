---
sidebar_position: 5
title: First Workflow
description: Walk through your first end-to-end agent interaction
---

# Your First Workflow

This page walks through a simple end-to-end interaction so you can see Manasvi working in practice.

## What we'll do

We'll send a question to Manasvi through the API gateway and see how it flows through the system. This works with the mock model adapter — you don't need an OpenAI key for this.

:::info Start everything first
Make sure all services are running. See [Run Locally](/docs/getting-started/run-locally) if you haven't done that yet.
:::

---

## Step 1 — Send a message

```bash
curl -X POST http://localhost:4100/v1/message \
  -H "Content-Type: application/json" \
  -d '{
    "text": "What tools do you have available?",
    "channel": "api",
    "userId": "user:alice"
  }'
```

You'll get back a response that includes:
- The agent's reply
- A trace ID (for tracking this specific request)
- Session information
- Any policy decisions that were made

---

## Step 2 — Understanding the response

The response will look something like:

```json
{
  "sessionId": "session:abc123",
  "traceId": "trace:xyz789",
  "response": {
    "text": "I have several tools available...",
    "model": "mock-adapter"
  },
  "decisions": [
    {
      "action": "orchestration.ingress-event.plan",
      "outcome": "ALLOW",
      "reasonCode": "ALLOW_BY_POLICY"
    }
  ]
}
```

Notice the `decisions` field. Manasvi records every policy decision, even for routine allowed actions. This is by design — the audit trail captures everything.

---

## Step 3 — Try a tool-requiring request

Now try asking for something that requires tool use:

```bash
curl -X POST http://localhost:4100/v1/message \
  -H "Content-Type: application/json" \
  -d '{
    "text": "Search the web for information about AI safety",
    "channel": "api",
    "userId": "user:alice"
  }'
```

This will trigger the full pipeline:
1. Orchestrator proposes using the web-search tool
2. Policy evaluates whether that tool is allowed for this user
3. An execution intent is created and signed
4. Execution manager validates the intent before running
5. The tool runs in a sandboxed environment
6. The result is returned and recorded in the audit stream

---

## Step 4 — View what was recorded

Every action Manasvi takes is recorded. You can see the audit trail:

```bash
curl http://localhost:4107/audit/events?limit=10
```

This returns the most recent 10 audit events. You'll see entries for:
- The incoming message being received
- Policy decisions
- Tool invocations
- Outcomes

---

## Step 5 — Check the session

Manasvi maintains session context across messages. Try sending a follow-up with the same session ID:

```bash
curl -X POST http://localhost:4100/v1/message \
  -H "Content-Type: application/json" \
  -d '{
    "text": "Tell me more about what you found",
    "channel": "api",
    "userId": "user:alice",
    "sessionId": "session:abc123"
  }'
```

The agent will remember the context from the previous message.

---

## What you've seen

In these few steps, you experienced:

- A message flowing through the ingress plane
- Policy evaluation on every action
- A signed execution intent being created
- Sandboxed tool execution
- An append-only audit record of everything

This is the foundation of how Manasvi works — every interaction is governed, recorded, and attributable.

---

## Next steps

- [Connect Telegram](/docs/setup/connect-telegram) — receive real messages from a Telegram bot
- [Core concepts](/docs/concepts/agent-runtime) — understand the components in plain language
- [Architecture overview](/docs/architecture/overview) — see how the services fit together
