---
sidebar_position: 2
title: Connect Telegram
description: Set up a Telegram bot to talk to Manasvi
---

# Connect Telegram

This guide walks you through connecting a Telegram bot to Manasvi so you can send it messages directly from your phone or Telegram desktop app.

**What you'll need:** A Telegram account. That's it.

---

## How it works

When you connect Telegram:

1. You create a bot in Telegram using a tool called BotFather
2. Telegram gives you a secret token that identifies your bot
3. You tell Telegram to send new messages to Manasvi's URL (called a webhook)
4. Manasvi receives messages, processes them, and replies

**What is a webhook?** A webhook is a URL that Telegram calls whenever someone sends a message to your bot. It's like giving Telegram your address so it knows where to deliver the mail.

---

## Step 1 — Create a Telegram bot

1. Open Telegram and search for **@BotFather**
2. Start a chat with BotFather and type `/newbot`
3. Follow the prompts — give your bot a name and a username
4. BotFather will give you a **bot token** that looks like: `7123456789:AAEOm3xyzABCdef...`

**Keep this token safe.** It's the password for your bot. Anyone with this token can control your bot.

---

## Step 2 — Add the token to your configuration

Open your `.env` file and add:

```ini
TELEGRAM_BOT_TOKEN=7123456789:AAEOm3xyzABCdef...
TELEGRAM_WEBHOOK_SECRET=choose-any-random-secret-here
```

**What is the webhook secret?** This is an extra security check. When Telegram sends a message to Manasvi, it includes this secret so Manasvi knows the message is really from Telegram and not from someone pretending to be Telegram.

---

## Step 3 — Make your server accessible

**Important:** Telegram needs to be able to reach your Manasvi ingress service from the internet. For local development, your laptop isn't directly accessible from the internet, so you need a tunnel.

### Using ngrok (easiest option)

[ngrok](https://ngrok.com) creates a public URL that forwards traffic to your local machine.

1. Download and install ngrok from [ngrok.com](https://ngrok.com)
2. Run: `ngrok http 4101`
3. ngrok will show you a URL like `https://abc123.ngrok-free.app` — copy this

### Other tunnel options

- **Cloudflare Tunnel** (`cloudflared tunnel`)
- **localtunnel** (`npx localtunnel --port 4101`)

---

## Step 4 — Register the webhook

Now tell Telegram where to send messages. Replace `<TOKEN>` with your bot token and `<NGROK_URL>` with your tunnel URL:

```bash
curl -X POST "https://api.telegram.org/bot<TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://<NGROK_URL>/channels/telegram/webhook",
    "secret_token": "choose-any-random-secret-here"
  }'
```

You should see: `{"ok":true,"result":true,"description":"Webhook was set"}`

---

## Step 5 — Verify the webhook

Check that Telegram can reach your bot:

```bash
curl "https://api.telegram.org/bot<TOKEN>/getWebhookInfo"
```

You should see your webhook URL and `"last_error_message"` should be empty.

---

## Step 6 — Send a message

Open Telegram, find your bot, and send it a message. Manasvi should respond!

If it doesn't, check:
- Is the ingress service running? (`curl http://localhost:4101/health`)
- Is your tunnel still active?
- Are there errors in the ingress service logs?

---

## What Manasvi does with Telegram messages

When a Telegram message arrives:

1. Manasvi verifies the webhook secret to confirm it's from Telegram
2. The user's Telegram ID becomes their principal identity (`telegram:12345`)
3. Messages from channels Manasvi hasn't seen before are assigned a default trust level
4. The message is normalized and routed through the full agent pipeline
5. The response is sent back to the same Telegram chat

---

## Troubleshooting

**"Webhook not set" error:** Make sure your tunnel is running before registering the webhook URL.

**No response from bot:** Check that all Manasvi services are running, especially the ingress service and orchestrator.

**"Unauthorized" error:** Double-check your `TELEGRAM_BOT_TOKEN` — it must match exactly what BotFather gave you.
