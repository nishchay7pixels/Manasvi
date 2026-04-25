---
sidebar_position: 4
title: Run Locally
description: Start all Manasvi services and verify they are running
---

# Run Manasvi Locally

Manasvi is a multi-service system. Several services need to run simultaneously. This page explains how to start them.

## Start all services

The easiest way to run everything at once:

```bash
pnpm dev
```

This starts all services in development mode using Turbo, which handles the dependency order automatically.

---

## Start services individually

If you prefer more control, open separate terminal windows for each service:

```bash
# Terminal 1 — Policy service (handles authorization decisions)
pnpm --filter @manasvi/policy-service dev

# Terminal 2 — Approval service (handles approval requests)
pnpm --filter @manasvi/approval-service dev

# Terminal 3 — Memory service (stores context and history)
pnpm --filter @manasvi/memory-service dev

# Terminal 4 — Execution manager (validates and runs tool actions)
pnpm --filter @manasvi/execution-manager dev

# Terminal 5 — Orchestrator (the agent runtime and planner)
pnpm --filter @manasvi/orchestrator-service dev

# Terminal 6 — Ingress service (receives messages from channels)
pnpm --filter @manasvi/ingress-service dev

# Terminal 7 — API gateway (public entry point)
pnpm --filter @manasvi/api-gateway dev
```

---

## Default service ports

| Service | Port | Purpose |
|---------|------|---------|
| API Gateway | 4100 | Public entry point for tests and direct API calls |
| Ingress Service | 4101 | Receives channel messages (Telegram, Slack, etc.) |
| Orchestrator | 4102 | Agent runtime, planner, session handling |
| Policy Service | 4103 | Authorization decisions |
| Execution Manager | 4104 | Tool execution and validation |
| Memory Service | 4105 | Context and memory storage |
| Node Manager | 4106 | Remote execution node management |
| Audit Service | 4107 | Audit trail ingestion |
| Approval Service | 4108 | Approval workflow |

---

## Verify it's running

Once services are started, you can check that the main gateway is healthy:

```bash
curl http://localhost:4100/health
```

You should see a JSON response like:

```json
{
  "status": "ok",
  "service": "api-gateway",
  "checks": [
    { "name": "config_loaded", "status": "ok" }
  ]
}
```

If you see an error, check the [Troubleshooting](/docs/getting-started/troubleshooting) page.

---

## Send a test message

To verify the full pipeline works, try sending a message through the API gateway:

```bash
curl -X POST http://localhost:4100/v1/message \
  -H "Content-Type: application/json" \
  -d '{
    "text": "Hello, what can you help me with?",
    "channel": "api",
    "userId": "user:test-user"
  }'
```

Manasvi will process the message through the ingress → orchestrator → policy → execution pipeline and return a response.

:::note
With `MODEL_ADAPTER_MODE=mock`, you'll get a predictable test response. Switch to `openai` or `ollama` mode to get real AI-generated responses.
:::

---

## What happens when you send a message?

Here's a simplified version of what Manasvi does with every message:

1. **Ingress** receives the message, verifies the source, and normalizes it into an internal format
2. **Orchestrator** resolves your identity, retrieves session context, and asks the model what to do
3. **Policy** evaluates whether any proposed action is allowed
4. **Approval service** handles any actions that require human sign-off
5. **Execution manager** validates the signed intent and runs the action in a sandbox
6. **Memory** stores the outcome for future context
7. **Audit** records everything that happened

You can continue to [First workflow](/docs/getting-started/first-workflow) to try a more complete example.
