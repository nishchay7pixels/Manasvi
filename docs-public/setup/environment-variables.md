---
sidebar_position: 5
title: Environment Variables
description: Complete reference for all Manasvi configuration settings
---

# Environment Variables Reference

This is the complete reference for all Manasvi configuration settings. All settings go in your `.env` file.

---

## Core security keys

These settings control how Manasvi services authenticate with each other internally. They are required.

| Variable | Description | Example |
|----------|-------------|---------|
| `INTERNAL_AUTH_KEY_ID` | ID of the key used to sign internal tokens | `local-k1` |
| `INTERNAL_AUTH_SIGNING_SECRET` | Secret used to sign internal tokens (min 32 chars in production) | `my-local-secret-at-least-32-chars` |
| `INTERNAL_AUTH_VERIFICATION_KEYS` | All valid keys, as `keyId:secret` pairs separated by commas | `local-k1:my-secret` |
| `INTERNAL_AUTH_ISSUER` | Token issuer identifier | `manasvi.internal.auth` |
| `INTERNAL_AUTH_AUDIENCE` | Token audience identifier | `manasvi.internal.services` |

---

## Approval keys

Used to sign and verify approval artifacts.

| Variable | Description | Example |
|----------|-------------|---------|
| `APPROVAL_SIGNING_KEY_ID` | Active key ID for signing approvals | `approval-k1` |
| `APPROVAL_SIGNING_KEYS` | Key pairs `id:secret`, comma-separated | `approval-k1:approval-secret` |
| `APPROVAL_VERIFICATION_KEYS` | Same format, all valid approval keys | `approval-k1:approval-secret` |

---

## Model provider

| Variable | Description | Default |
|----------|-------------|---------|
| `MANASVI_MODEL_PROVIDER` | Default provider (`deepseek`, `openai`, `ollama`, `claude`, `mock`) | `deepseek` |
| `MANASVI_MODEL` | Default model id | `deepseek-v4-flash` |
| `MODEL_ADAPTER_MODE` | `deepseek`, `openai`, `ollama`, `claude`, `mock`, or `auto` | `deepseek` |
| `PLANNER_MODEL` | Model name to use | `deepseek-v4-flash` |
| `DEEPSEEK_API_KEY` | DeepSeek API key | — |
| `DEEPSEEK_BASE_URL` | DeepSeek API base URL | `https://api.deepseek.com` |
| `DEEPSEEK_TIMEOUT_MS` | DeepSeek request timeout (ms) | `60000` |
| `OPENAI_API_KEY` | OpenAI API key | — |
| `OPENAI_BASE_URL` | OpenAI-compatible API base URL | `https://api.openai.com/v1` |
| `ANTHROPIC_API_KEY` | Anthropic API key | — |
| `ANTHROPIC_BASE_URL` | Anthropic API base URL | `https://api.anthropic.com` |
| `OLLAMA_BASE_URL` | Ollama API base URL | `http://localhost:11434/v1` |
| `MODEL_ADAPTER_TIMEOUT_MS` | Model request timeout (ms) | `60000` |
| `MODEL_ADAPTER_MAX_CONTEXT_CHUNKS` | Max context chunks to include | `24` |

---

## Service URLs

How services find each other. Defaults work for local development.

| Variable | Default |
|----------|---------|
| `EVENT_BUS_TARGET_URLS` | `http://localhost:4102/internal/events` |
| `POLICY_SERVICE_BASE_URL` | `http://localhost:4103` |
| `APPROVAL_SERVICE_BASE_URL` | `http://localhost:4108` |
| `EXECUTION_MANAGER_BASE_URL` | `http://localhost:4104` |
| `MEMORY_SERVICE_BASE_URL` | `http://localhost:4105` |
| `ORCHESTRATOR_BASE_URL` | `http://localhost:4102` |
| `NODE_MANAGER_BASE_URL` | `http://localhost:4106` |

---

## Service ports

Override the default port for any service.

| Variable | Default | Service |
|----------|---------|---------|
| `SERVICE_PORT` | Varies | Set per service |
| `SERVICE_HOST` | `0.0.0.0` | Bind address |

---

## Channel integrations

### Telegram

| Variable | Description |
|----------|-------------|
| `TELEGRAM_BOT_TOKEN` | Token from BotFather |
| `TELEGRAM_WEBHOOK_SECRET` | Random secret for webhook verification |

### Slack

| Variable | Description |
|----------|-------------|
| `SLACK_BOT_TOKEN` | Bot user OAuth token (`xoxb-...`) |
| `SLACK_SIGNING_SECRET` | Signing secret from Slack app settings |

---

## Execution and sandbox

| Variable | Description | Default |
|----------|-------------|---------|
| `EXECUTION_INTENT_TTL_SECONDS` | How long before an intent expires | `900` |
| `APPROVED_ARTIFACT_TTL_SECONDS` | How long an approval is valid | `900` |
| `APPROVAL_REQUEST_TTL_SECONDS` | How long before a pending approval expires | `3600` |
| `SANDBOX_ROOT_DIR` | Filesystem root for sandboxed executions | `/tmp/manasvi-runs` |
| `SANDBOX_MAX_OUTPUT_BYTES` | Maximum tool output size | `65536` |

---

## Logging

| Variable | Description | Default |
|----------|-------------|---------|
| `LOG_LEVEL` | `debug`, `info`, `warn`, `error` | `info` |
| `HUMAN_LOGS` | Set to `true` for human-readable logs | `false` |
| `SERVICE_VERSION` | Version string in logs | `0.1.0` |

---

## Agent loop behavior

| Variable | Description | Default |
|----------|-------------|---------|
| `AGENT_LOOP_MAX_ITERATIONS` | Max planning iterations per request | `6` |
| `AGENT_LOOP_MAX_CONSECUTIVE_FAILURES` | Max consecutive errors before halt | `2` |
| `SESSION_CONTEXT_TOKEN_BUDGET` | Context window limit (tokens) | `2048` |
| `SESSION_RECENT_MESSAGE_LIMIT` | Recent messages to include in context | `20` |

---

## Tips

- **Never commit `.env` to version control.** It contains secrets.
- For local development, simple consistent strings work fine for keys.
- In production, use random 32+ character secrets.
- Restart services after changing `.env` — settings are read at startup.
