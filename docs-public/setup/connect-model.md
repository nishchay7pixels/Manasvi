---
sidebar_position: 4
title: Configure a Model
description: Connect Manasvi to an AI model provider
---

# Configure a Model Provider

Manasvi uses a language model to generate responses and make decisions about tool use. This page explains how to connect it to different providers.

---

## Available adapters

| Mode | Provider | Requires | Best for |
|------|----------|----------|----------|
| `openai` | OpenAI API | API key | Cloud-based models (GPT-4, etc.) |
| `ollama` | Ollama (local) | Ollama installed | Privacy, local inference |
| `mock` | Built-in test adapter | Nothing | Development, testing |
| `auto` | Detected automatically | Depends | Default mode |

---

## OpenAI (or compatible API)

If you have an OpenAI API key, or access to any OpenAI-compatible API:

```ini
MODEL_ADAPTER_MODE=openai
OPENAI_API_KEY=sk-your-key-here
PLANNER_MODEL=gpt-4o
OPENAI_BASE_URL=https://api.openai.com/v1
```

**Which model should I use?** Manasvi works best with models that follow instructions reliably. `gpt-4o` and `gpt-4-turbo` work well. For testing, `gpt-3.5-turbo` is cheaper.

**OpenAI-compatible APIs:** If you're using a service that provides an OpenAI-compatible API (like Azure OpenAI, Groq, Mistral API, etc.), change `OPENAI_BASE_URL` to point to that service.

---

## Ollama (local model)

Ollama lets you run models directly on your computer — no internet connection needed after setup, no API costs, and your data stays on your machine.

### Install Ollama

Download from [ollama.com](https://ollama.com) and install it.

### Download a model

```bash
# Llama 3.2 (3B or 8B) — good for most tasks
ollama pull llama3.2

# Mistral — fast and capable
ollama pull mistral

# Qwen — good instruction following
ollama pull qwen2.5
```

### Configure Manasvi

```ini
MODEL_ADAPTER_MODE=ollama
OLLAMA_BASE_URL=http://localhost:11434/v1
PLANNER_MODEL=llama3.2
```

### Start Ollama

```bash
ollama serve
```

Ollama needs to be running when Manasvi is running.

:::tip
Smaller models (3B–7B parameters) run well on most modern laptops with 8GB RAM. Larger models (13B+) need more RAM or a GPU.
:::

---

## Mock adapter (for development)

The mock adapter returns predictable test responses without connecting to any AI provider. It's useful for:

- Testing that the pipeline works without spending on API calls
- Developing new features without needing internet access
- Running automated tests

```ini
MODEL_ADAPTER_MODE=mock
```

The mock adapter always returns a short test response and simulates the behavior of a real model.

---

## Auto detection

The default mode is `auto`. Manasvi will:
1. Use OpenAI if `OPENAI_API_KEY` is set
2. Fall back to mock mode if no API key is found

```ini
MODEL_ADAPTER_MODE=auto
```

---

## Adjusting model behavior

```ini
# How long to wait for the model (in milliseconds)
MODEL_ADAPTER_TIMEOUT_MS=20000

# Maximum context chunks fed to the model
MODEL_ADAPTER_MAX_CONTEXT_CHUNKS=24
```

The model timeout default is 20 seconds. If you're using a slow local model, increase this.
