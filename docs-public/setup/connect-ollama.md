---
sidebar_position: 3
title: Connect Ollama
description: Run a local AI model with Ollama — no API key, no cloud costs
---

# Connect Ollama

Ollama lets you run AI models directly on your computer. No API key, no cloud account, no usage costs. The model runs entirely on your machine.

This is the recommended way to run Manasvi locally.

---

## What is Ollama?

Ollama is a tool that downloads and runs AI language models on your computer. Once you've pulled a model, it works offline — your data never leaves your machine.

Supported models include Llama 3, Mistral, Qwen, Phi, Gemma, and many others. All free to download and use.

---

## Step 1 — Install Ollama

Download and install Ollama from [ollama.com](https://ollama.com). It's available for macOS, Linux, and Windows.

After installing, start the Ollama server:

```bash
ollama serve
```

You should see output like:
```
Ollama is running on http://localhost:11434
```

Leave this running in the background while you use Manasvi.

---

## Step 2 — Pull a model

```bash
# Llama 3.2 (3B) — recommended for most laptops, fast
ollama pull llama3.2

# Llama 3.2 (8B) — better quality, needs more RAM
ollama pull llama3.2:8b

# Mistral — fast, good general performance
ollama pull mistral

# Qwen 2.5 — strong instruction following
ollama pull qwen2.5
```

**Which model should I choose?**

| Model | Size | RAM needed | Best for |
|-------|------|-----------|----------|
| `llama3.2` (3B) | ~2GB | 4GB | Fast responses, lower-spec machines |
| `llama3.2:8b` | ~5GB | 8GB | Better quality, good for most tasks |
| `mistral` (7B) | ~4GB | 8GB | Fast, general purpose |
| `qwen2.5` (7B) | ~4GB | 8GB | Strong at following instructions |

The download only happens once. After that, the model is stored locally.

---

## Step 3 — Configure Manasvi

### Using the CLI (recommended)

```bash
pnpm manasvi models add ollama
```

This prompts you for the model name and writes the settings automatically.

If you're doing this during first-time setup, use:

```bash
pnpm manasvi onboard
```

And select **Ollama (local)** when prompted.

### Manually

Add these to your `.env.local` file:

```ini
MODEL_ADAPTER_MODE=ollama
OLLAMA_BASE_URL=http://localhost:11434/v1
PLANNER_MODEL=llama3.2
```

Then restart Manasvi:

```bash
pnpm manasvi restart
```

---

## Step 4 — Verify the connection

```bash
pnpm manasvi models test
```

This sends a test request to Ollama and reports success or the specific error.

```bash
pnpm manasvi doctor
```

The doctor command checks whether Ollama is reachable and reports its status in the **Model Backend** section.

---

## Switch between models

To try a different model without re-running onboard:

```bash
# Pull the model first
ollama pull qwen2.5

# Then update the config
pnpm manasvi models use ollama
```

It will prompt you for the model name.

Or edit `.env.local` directly:
```ini
PLANNER_MODEL=qwen2.5
```

And restart:
```bash
pnpm manasvi restart
```

---

## Troubleshooting

### "Ollama is not running"

Start Ollama first:
```bash
ollama serve
```

Check it's working:
```bash
curl http://localhost:11434/api/tags
```

You should see a JSON list of your pulled models.

### "Model not found"

Make sure you've pulled the model you specified:
```bash
ollama list        # see what's installed
ollama pull llama3.2  # pull if missing
```

### Slow responses

Local models are slower than cloud APIs, especially on first load (the model needs to load into memory). After the first request, subsequent ones are faster.

To check if Ollama is overloaded:
```bash
ollama ps
```

### Out of memory

Try a smaller model:
```bash
ollama pull llama3.2  # 3B version uses less RAM than 8B
```

Or close other memory-heavy applications while Manasvi is running.

---

## Using a different Ollama port

If Ollama is running on a non-default port, update your `.env.local`:

```ini
OLLAMA_BASE_URL=http://localhost:11435/v1
```

Or run `pnpm manasvi models add ollama` and enter the custom URL when prompted.
