---
sidebar_position: 3
title: Install Manasvi
description: Download and install Manasvi on your machine
---

# Install Manasvi

This guide walks you through downloading the Manasvi source code and getting it ready to run.

:::info Before you start
Make sure you've completed the [Prerequisites](/docs/getting-started/prerequisites) step. You need Node.js 18+, pnpm, and Git.
:::

## Step 1 — Download the code

Open your terminal and run:

```bash
git clone https://github.com/nishchay7pixels/manasvi.git
cd manasvi
```

**What is this doing?** `git clone` downloads a copy of the Manasvi code from GitHub to your computer. `cd manasvi` moves you into the downloaded folder.

---

## Step 2 — Install dependencies

```bash
pnpm install
```

This downloads all the libraries Manasvi needs to run. It may take a minute or two the first time.

**What does this do?** Manasvi is made up of many services (a policy engine, an orchestrator, a memory system, etc.). Each service depends on certain libraries. `pnpm install` downloads them all at once.

---

## Step 3 — Set up configuration

Manasvi uses a configuration file called `.env` to store settings like API keys and secrets. There is an example file called `.env.example` that shows you what is needed.

Copy it to create your own:

```bash
cp .env.example .env
```

Then open `.env` in any text editor (like VS Code, Notepad, or nano) and fill in the values.

**What is an `.env` file?** It is a simple text file full of settings. Each line looks like `SETTING_NAME=value`. These settings are read by the services when they start up. You never commit this file to version control — it stays on your machine.

---

## Step 4 — Fill in the configuration

Here are the key settings you need to decide on:

### Model provider (pick one)

**Option A: Use OpenAI**
```ini
MODEL_ADAPTER_MODE=openai
OPENAI_API_KEY=sk-your-key-here
```

**Option B: Use Ollama (local)**
```ini
MODEL_ADAPTER_MODE=ollama
OLLAMA_BASE_URL=http://localhost:11434/v1
PLANNER_MODEL=llama3.2
```

**Option C: Use mock (for testing, no AI provider needed)**
```ini
MODEL_ADAPTER_MODE=mock
```

### Security keys (required)

Manasvi signs and verifies internal messages with cryptographic keys. For local development, you can use any random strings. For example:

```ini
INTERNAL_AUTH_KEY_ID=local-key-1
INTERNAL_AUTH_SIGNING_SECRET=change-me-local-dev-secret-32chars
INTERNAL_AUTH_VERIFICATION_KEYS=local-key-1:change-me-local-dev-secret-32chars
```

:::caution
These are internal signing secrets, not passwords. In production, generate long random strings (32+ characters). For local development, any consistent strings work.
:::

### Approval keys (required)

```ini
APPROVAL_SIGNING_KEYS=approval-k1:approval-secret-dev
APPROVAL_SIGNING_KEY_ID=approval-k1
APPROVAL_VERIFICATION_KEYS=approval-k1:approval-secret-dev
```

The full list of configuration options is in the [Environment Variables reference](/docs/setup/environment-variables).

---

## Step 5 — Build the project

```bash
pnpm build
```

This compiles the TypeScript source code. You need to do this once before running Manasvi for the first time, and again after any code changes.

---

## You're installed

You're ready to run Manasvi. Continue to [Run Locally](/docs/getting-started/run-locally).
