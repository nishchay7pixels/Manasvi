---
sidebar_position: 6
title: Connect Claude
description: Configure Anthropic Claude as a first-class model provider in Manasvi
---

# Connect Claude (Anthropic)

This guide configures Claude as the active model provider in Manasvi.

---

## 1. Get an Anthropic API key

Create or copy an API key from [console.anthropic.com](https://console.anthropic.com).

The key format usually starts with `sk-ant-...`.

---

## 2. Configure Claude in Manasvi

Use the CLI flow (recommended):

```bash
pnpm manasvi models add claude
```

You will be prompted for:
- Anthropic API key
- Anthropic base URL (default: `https://api.anthropic.com`)
- Claude model id (for example `claude-3-5-sonnet-latest`)

Then set Claude active:

```bash
pnpm manasvi models use claude
```

---

## 3. Test connectivity

```bash
pnpm manasvi models test
```

Expected result:
- API key is accepted
- Anthropic endpoint is reachable
- current provider test succeeds

---

## 4. Start Manasvi with Claude

```bash
pnpm manasvi restart
pnpm cli
```

Manasvi now uses Claude through the same provider abstraction used by other model providers.

---

## Manual `.env.local` configuration (optional)

```ini
MODEL_ADAPTER_MODE=claude
PLANNER_MODEL=claude-3-5-sonnet-latest
ANTHROPIC_API_KEY=sk-ant-your-key
ANTHROPIC_BASE_URL=https://api.anthropic.com
```

---

## Troubleshooting

- `MODEL_ADAPTER_MODE=claude requires ANTHROPIC_API_KEY`
  - Add `ANTHROPIC_API_KEY` in `.env.local` or run `pnpm manasvi models add claude`.

- `claude request failed: 401 ...`
  - API key is invalid or revoked.

- `claude request failed: 429 ...`
  - Rate-limit/quota issue from Anthropic API.

- `models test` fails in local sandboxed CI
  - Validate network egress and DNS from the running host.

