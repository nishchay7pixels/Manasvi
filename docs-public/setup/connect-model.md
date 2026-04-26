---
sidebar_position: 4
title: Configure a Model
description: Connect Manasvi to an AI model provider
---

# Configure a Model Provider

Manasvi uses a language model to generate responses and decide when to use tools. This page explains how to connect it to different providers.

---

## Available providers

| Mode | Provider | Requires | Best for |
|------|----------|----------|----------|
| `mock` | Built-in test adapter | Nothing | Development, testing |
| `ollama` | Ollama (local) | Ollama installed | Privacy, local inference, no API costs |
| `openai` | OpenAI API | API key | Cloud-based models (GPT-4o, etc.) |
| `claude` | Anthropic Claude | API key | Cloud-based Claude models |

---

For a dedicated Claude walkthrough, see [Connect Claude](/docs/setup/connect-claude).

---

## Using the CLI (recommended)

The easiest way to switch providers is through the CLI:

```bash
pnpm manasvi models list
```

Shows your configured providers and which one is active.

```bash
pnpm manasvi models add ollama
# or
pnpm manasvi models add openai
# or
pnpm manasvi models add claude
```

Walks you through the configuration interactively and writes the settings to `.env.local`.

```bash
pnpm manasvi models test
```

Sends a test request to verify connectivity.

```bash
pnpm manasvi models use ollama
# or
pnpm manasvi models use openai
# or
pnpm manasvi models use claude
# or
pnpm manasvi models use mock
```

Switches the active provider. Then run `pnpm manasvi restart` to apply changes to running services.

---

## Mock adapter (default)

The mock adapter returns predictable test responses without connecting to any AI provider. Manasvi starts in mock mode after `pnpm manasvi init` — you don't need to configure anything to explore the system.

Useful for:
- Verifying the full pipeline works end-to-end before setting up a real model
- Automated tests
- Offline development

---

## Ollama (local model)

Ollama runs models directly on your computer — no internet connection after setup, no API costs, data stays on your machine.

### Install Ollama

Download from [ollama.com](https://ollama.com) and install it.

### Download a model

```bash
# Llama 3.2 — good balance of speed and capability
ollama pull llama3.2

# Mistral — fast
ollama pull mistral

# Qwen — good instruction following
ollama pull qwen2.5
```

### Configure via CLI

```bash
pnpm manasvi models add ollama
```

Or manually in `.env.local`:

```ini
MODEL_ADAPTER_MODE=ollama
OLLAMA_BASE_URL=http://localhost:11434/v1
PLANNER_MODEL=llama3.2
```

### Start Ollama

```bash
ollama serve
```

Ollama needs to be running while Manasvi is running. Run `pnpm manasvi doctor` if connectivity fails — it checks whether the Ollama endpoint is reachable.

:::tip
Smaller models (3B–7B parameters) run well on most modern laptops with 8GB RAM. Larger models (13B+) need more RAM or a GPU.
:::

---

## OpenAI (or compatible API)

```bash
pnpm manasvi models add openai
```

Or manually in `.env.local`:

```ini
MODEL_ADAPTER_MODE=openai
OPENAI_API_KEY=sk-your-key-here
PLANNER_MODEL=gpt-4o
OPENAI_BASE_URL=https://api.openai.com/v1
```

**Which model?** `gpt-4o` works well for most tasks. `gpt-4o-mini` is significantly cheaper and sufficient for most agent workflows.

**OpenAI-compatible APIs:** Change `OPENAI_BASE_URL` to point to any compatible service (Azure OpenAI, Groq, Mistral API, etc.).

### Test connectivity

```bash
pnpm manasvi models test
```

This sends a minimal request and shows the error if the key is wrong or quota is exceeded.

---

## Claude (Anthropic)

```bash
pnpm manasvi models add claude
```

Or manually in `.env.local`:

```ini
MODEL_ADAPTER_MODE=claude
ANTHROPIC_API_KEY=sk-ant-your-key-here
PLANNER_MODEL=claude-3-5-sonnet-latest
ANTHROPIC_BASE_URL=https://api.anthropic.com
```

During `models add claude`, Manasvi will:
- validate the API key (if possible),
- attempt model discovery through Anthropic Models API,
- let you choose a default Claude model,
- store the active provider cleanly alongside Ollama/OpenAI config.

You can obtain a key from [console.anthropic.com](https://console.anthropic.com).

---

## Adjusting model behavior

These settings apply to all providers:

```ini
# How long to wait for the model (milliseconds)
MODEL_ADAPTER_TIMEOUT_MS=20000

# Maximum context chunks fed to the model
MODEL_ADAPTER_MAX_CONTEXT_CHUNKS=24
```

The timeout default is 20 seconds. Increase it if you're using a slow local model or a heavily loaded API.
