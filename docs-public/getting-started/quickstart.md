---
sidebar_position: 2
title: 15-Minute Quickstart
description: Install, onboard, and send your first message to Manasvi
---

# 15-Minute Quickstart

This guide gets you from nothing to a running Manasvi agent — with a real model and a real first message — in about 15 minutes.

We'll use **Ollama** (free, runs locally, no API key) and the **terminal chat interface**. If you want to use OpenAI, Claude, or connect Telegram instead, you can do those steps after the initial setup.

---

## What you'll need

Before starting, make sure you have:

- **Node.js 20 or newer** — check with `node --version`
- **pnpm** — check with `pnpm --version` (install with `corepack enable`)
- **Git** — check with `git --version`
- **Ollama** — download from [ollama.com](https://ollama.com) (free, takes ~2 minutes)

If you're missing any of these, see [Prerequisites](/docs/getting-started/prerequisites) for install instructions.

:::tip Skip Ollama for now
If you don't want to install Ollama yet, you can use **mock mode** — it gives predictable test responses without connecting to any AI. You'll still see the full pipeline working.
:::

---

## Step 1 — Get Ollama ready (5 min)

If you're using Ollama, do this first:

```bash
# Start Ollama
ollama serve
```

In a separate terminal, pull a model:

```bash
# Llama 3.2 (3B) — fast, works on most laptops with 8GB RAM
ollama pull llama3.2
```

This downloads about 2GB. It only happens once.

**What is Ollama?** It's a tool that runs AI models locally on your computer. Once you've pulled a model, everything happens on your machine — no internet connection needed, no API costs.

---

## Step 2 — Download Manasvi (1 min)

```bash
git clone https://github.com/nishchay7pixels/manasvi.git
cd manasvi
corepack enable
pnpm install
```

---

## Step 3 — Initialize (1 min)

```bash
pnpm manasvi init
```

This does three things:
1. Checks your environment (Node.js, pnpm, etc.)
2. Creates `~/.manasvi/` — where CLI config and logs are stored
3. Generates all required cryptographic secrets into `.env.local` — no manual editing needed

Expected output:
```
  Manasvi  init

  Checking prerequisites
  ✔ Node.js          v22.1.0
  ✔ pnpm             found
  ✔ tsx              found
  ✔ Manasvi project  /path/to/manasvi

  Generating secrets
  ✔ Generated 10 secrets → .env.local

  ✔ Manasvi initialized successfully
```

**What is `.env.local`?** It's a file that holds settings and secrets for your local Manasvi instance. Manasvi generates all the cryptographic values you need automatically — you don't need to create them yourself.

---

## Step 4 — Onboard (2 min)

```bash
pnpm manasvi onboard
```

This walks you through choosing your model and connecting a channel. It's interactive — just follow the prompts.

**Choose Ollama:**
```
  Model Provider
  ? Which model provider do you want to use?
  ❯ Ollama (local)    Run models on your own machine — no API key needed
    OpenAI (cloud)    Use GPT models via OpenAI API key
    Claude (Anthropic cloud) Use Claude models via Anthropic API key
    Mock (testing)    Simulated responses — useful for testing the system

  ✔ Ollama is running at http://localhost:11434/v1
  ? Which Ollama model?  llama3.2
  ✔ Model: Ollama / llama3.2
```

**Choose a channel (or skip for now):**

You can connect Telegram now, or skip it and use the terminal chat interface first.

```
  Channels
  ? Connect a Telegram bot?  No

  Web UI & Docs
  ? Enable the documentation web UI?  Yes
  ✔ Docs UI will be available at http://localhost:3002
```

---

## Step 5 — Start (1 min)

```bash
pnpm manasvi start
```

All nine services start in dependency order. You'll see them come up one by one:

```
  Starting services
  ✔ Policy
  ✔ Approval
  ✔ Memory
  ✔ Audit
  ✔ Execution Manager
  ✔ Node Manager
  ✔ Orchestrator
  ✔ Ingress
  ✔ API Gateway

  ✔ 9 service(s) started

  → pnpm manasvi status  check all service health
  → pnpm cli             chat with Manasvi in the terminal
  → pnpm manasvi stop    stop all services
```

---

## Step 6 — Send your first message (2 min)

```bash
pnpm cli
```

This opens an interactive terminal chat. Type a message and press Enter:

```
Manasvi terminal  (session: session:abc123)
Type a message, or /help for commands.

You: What can you help me with?

Agent: I can help you with a range of tasks. I have access to tools like
       web search, file operations, and HTTP requests...
```

Try a few messages. Each one flows through the full pipeline: ingress → orchestrator → policy → (optionally) execution → audit.

:::tip
Type `/session` to see your current session ID, or `/new` to start a fresh conversation.
:::

---

## Step 7 — Check the status

In another terminal:

```bash
pnpm manasvi status
```

```
  Services
  API Gateway           :4100   ● healthy (12ms)
  Ingress Service       :4101   ● healthy (9ms)
  Orchestrator          :4102   ● healthy (14ms)
  Policy Service        :4103   ● healthy (8ms)
  Execution Manager     :4104   ● healthy (11ms)
  Memory Service        :4105   ● healthy (10ms)
  Node Manager          :4106   ● healthy (9ms)
  Audit Service         :4107   ● healthy (8ms)
  Approval Service      :4108   ● healthy (9ms)

  ✔ All 9 services healthy

  Configuration
  Model      Ollama / llama3.2
  Channels   none
  Docs UI    http://localhost:3002
```

---

## You're up and running

You've just run a full governed AI agent pipeline locally:

- Your message flowed through the **ingress plane**
- The **orchestrator** resolved your session and asked the model what to do
- The **policy service** evaluated whether any actions were allowed
- The **audit service** recorded everything that happened

---

## What to do next

**Connect Telegram** — send messages to your agent from your phone:
→ [Connect Telegram](/docs/setup/connect-telegram)

**Connect Ollama with a different model** — try Mistral, Qwen, or Llama 3.3:
→ [Connect Ollama](/docs/setup/connect-ollama)

**Use OpenAI instead** — switch to GPT-4o or GPT-4o-mini:
→ [Configure a model](/docs/setup/connect-model)

**Use Claude instead** — switch to Anthropic Claude models:
→ [Connect Claude](/docs/setup/connect-claude)

**Understand the system** — learn what each part does and why:
→ [Core concepts](/docs/concepts/agent-runtime)

**Something went wrong?** — run `pnpm manasvi doctor` first:
→ [Troubleshooting](/docs/getting-started/troubleshooting)
