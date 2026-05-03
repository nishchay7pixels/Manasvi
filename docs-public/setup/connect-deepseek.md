---
sidebar_position: 2
title: Connect DeepSeek
description: Configure DeepSeek as the default model provider in Manasvi
---

# Connect DeepSeek

DeepSeek is the default model provider for Manasvi.

Default model:

```txt
deepseek-v4-flash
```

## Setup

```bash
export DEEPSEEK_API_KEY="..."
pnpm manasvi doctor
```

## Configuration

| Variable | Default | Description |
|---|---|---|
| `MANASVI_MODEL_PROVIDER` | `deepseek` | Model provider |
| `MANASVI_MODEL` | `deepseek-v4-flash` | Model id |
| `DEEPSEEK_API_KEY` | none | DeepSeek API key |
| `DEEPSEEK_BASE_URL` | `https://api.deepseek.com` | DeepSeek API base URL |
| `DEEPSEEK_TIMEOUT_MS` | `60000` | Request timeout |

## Example

```bash
export DEEPSEEK_API_KEY="..."
export MANASVI_MODEL_PROVIDER="deepseek"
export MANASVI_MODEL="deepseek-v4-flash"

pnpm manasvi doctor
pnpm manasvi start
```

## Security

Manasvi never allows the model provider to execute tools directly. The model can propose tool calls, but Manasvi's policy and approval layers decide whether execution is allowed.
