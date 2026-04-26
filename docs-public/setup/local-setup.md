---
sidebar_position: 1
title: Local Setup
description: Complete guide to running Manasvi on your local machine
---

# Local Setup

This is the complete guide to getting Manasvi running on your local machine from scratch.

## What you're setting up

Manasvi is made up of several services that work together. By the end of this guide, you'll have all of them running locally and able to communicate with each other.

Here's a simplified picture:

```
Your message
    ↓
API Gateway (port 4100)
    ↓
Ingress Service (port 4101)   ← verifies and normalizes
    ↓
Orchestrator (port 4102)      ← agent brain
    ↓ ↑ ↓ ↑ ↓
Policy (4103)  Memory (4105)  Approval (4108)
    ↓
Execution Manager (port 4104) ← runs tools safely
    ↓
Audit Service (port 4107)     ← records everything
```

---

## 1. Clone and install

```bash
git clone https://github.com/nishchay7pixels/manasvi.git
cd manasvi
pnpm install
```

---

## 2. Configure environment

```bash
cp .env.example .env
```

Open `.env` and configure the following sections:

### Core security keys

These keys are used to sign and verify internal messages between services. For local development, any consistent strings work.

```ini
INTERNAL_AUTH_KEY_ID=local-k1
INTERNAL_AUTH_SIGNING_SECRET=local-signing-secret-min-32-chars--
INTERNAL_AUTH_VERIFICATION_KEYS=local-k1:local-signing-secret-min-32-chars--

APPROVAL_SIGNING_KEYS=approval-k1:approval-local-secret-32chars
APPROVAL_SIGNING_KEY_ID=approval-k1
APPROVAL_VERIFICATION_KEYS=approval-k1:approval-local-secret-32chars
```

### Model adapter

Pick the AI provider you want to use:

```ini
# Option 1: OpenAI
MODEL_ADAPTER_MODE=openai
OPENAI_API_KEY=sk-...

# Option 2: Ollama (local)
MODEL_ADAPTER_MODE=ollama
OLLAMA_BASE_URL=http://localhost:11434/v1
PLANNER_MODEL=llama3.2

# Option 3: Claude (Anthropic)
MODEL_ADAPTER_MODE=claude
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_BASE_URL=https://api.anthropic.com
PLANNER_MODEL=claude-3-5-sonnet-latest

# Option 4: Mock (no AI needed)
MODEL_ADAPTER_MODE=mock
```

### Service URLs

These tell each service where to find the others. The defaults work for local development:

```ini
POLICY_SERVICE_BASE_URL=http://localhost:4103
APPROVAL_SERVICE_BASE_URL=http://localhost:4108
EXECUTION_MANAGER_BASE_URL=http://localhost:4104
MEMORY_SERVICE_BASE_URL=http://localhost:4105
ORCHESTRATOR_BASE_URL=http://localhost:4102
NODE_MANAGER_BASE_URL=http://localhost:4106
EVENT_BUS_TARGET_URLS=http://localhost:4102/internal/events
```

---

## 3. Build

```bash
pnpm build
```

---

## 4. Start services

```bash
pnpm dev
```

Or start services in separate terminals for easier log reading — see [Run Locally](/docs/getting-started/run-locally) for individual commands.

---

## 5. Verify

```bash
# Check gateway health
curl http://localhost:4100/health

# Check orchestrator
curl http://localhost:4102/

# Check policy service
curl http://localhost:4103/
```

Each should return a JSON response with `"status": "ok"` or service info.

---

## 6. Test the pipeline

```bash
curl -X POST http://localhost:4100/v1/message \
  -H "Content-Type: application/json" \
  -d '{
    "text": "Hello",
    "channel": "api",
    "userId": "user:test"
  }'
```

You're up and running.

---

## Next steps

- [Connect Telegram](/docs/setup/connect-telegram) to receive messages from a bot
- [Connect a model](/docs/setup/connect-model) to use a real AI provider
- [Environment variables reference](/docs/setup/environment-variables) for all configuration options
