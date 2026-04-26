---
sidebar_position: 2
title: Connect Telegram
description: Set up a Telegram bot to talk to Manasvi
---

# Connect Telegram

This guide walks you through connecting a Telegram bot to Manasvi so you can send messages directly from your phone or Telegram desktop app.

**What you'll need:** A Telegram account. That's it.

---

## How it works

1. You create a bot in Telegram using BotFather
2. Telegram gives you a secret token that identifies your bot
3. Manasvi's ingress service polls the Telegram API for new messages (no public URL needed for local development)
4. Manasvi processes messages and replies through the same bot

---

## Step 1 — Create a Telegram bot

1. Open Telegram and search for **@BotFather**
2. Start a chat and type `/newbot`
3. Follow the prompts — give your bot a name and a username
4. BotFather will give you a **bot token** that looks like: `7123456789:AAEOm3xyzABCdef...`

Keep this token safe — it's the password for your bot.

---

## Step 2 — Add the channel via CLI

```bash
pnpm manasvi channels add telegram
```

The CLI will prompt you for your bot token and write it to `.env.local`:

```
  Add channel  telegram

  ? Telegram bot token: ****************************

  ✔ Telegram channel configured
  → Restart services to apply: pnpm manasvi restart
```

That's it for local development. Polling mode is the default — no public URL or ngrok required.

---

## Step 3 — Restart and verify

```bash
pnpm manasvi restart
pnpm manasvi channels status
```

You should see:

```
  Channels
  telegram    ● active   polling
```

Send a message to your bot in Telegram. Manasvi will respond.

---

## Using webhook mode (optional)

If you want to use webhook mode instead of polling — for example, to reduce latency in production — you need a publicly accessible URL.

### With ngrok (local development)

```bash
ngrok http 4101
```

Copy the URL ngrok gives you (e.g., `https://abc123.ngrok-free.app`), then add it to `.env.local`:

```ini
TELEGRAM_WEBHOOK_URL=https://abc123.ngrok-free.app
```

Then register the webhook with Telegram:

```bash
curl -X POST "https://api.telegram.org/bot<TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://abc123.ngrok-free.app/channels/telegram/webhook",
    "secret_token": "<your-TELEGRAM_WEBHOOK_SECRET>"
  }'
```

---

## What Manasvi does with Telegram messages

When a Telegram message arrives:

1. The ingress service verifies the source (polling: always Telegram API; webhook: validates the secret)
2. The user's Telegram ID becomes their principal identity (`telegram:12345`)
3. The message is normalized and routed through the full agent pipeline
4. The response is sent back to the same chat

---

## Troubleshooting

Run `pnpm manasvi doctor` — it checks ingress service health and Telegram configuration.

**No response from bot:**
```bash
pnpm manasvi status
# Make sure ingress-service shows healthy
```

**Wrong token:**
```bash
pnpm manasvi channels remove telegram
pnpm manasvi channels add telegram
# Re-enter the correct token
```
