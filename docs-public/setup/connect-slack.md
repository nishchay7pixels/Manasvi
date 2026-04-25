---
sidebar_position: 3
title: Connect Slack
description: Set up a Slack app to talk to Manasvi
---

# Connect Slack

This guide walks you through connecting Manasvi to a Slack workspace so team members can interact with it through Slack.

---

## How it works

1. You create a Slack app in your workspace
2. Slack gives you a bot token and a signing secret
3. You configure Slack to send events (like messages) to Manasvi's webhook URL
4. Manasvi receives messages, processes them, and replies

---

## Step 1 — Create a Slack app

1. Go to [api.slack.com/apps](https://api.slack.com/apps)
2. Click **Create New App** → **From scratch**
3. Give it a name (e.g., "Manasvi") and choose your workspace
4. Click **Create App**

---

## Step 2 — Configure bot permissions

In your app settings, go to **OAuth & Permissions** → **Scopes** → **Bot Token Scopes** and add:

- `chat:write` — to send messages
- `app_mentions:read` — to receive @mentions
- `im:history` — to read direct messages (if you want DM support)

---

## Step 3 — Install the app to your workspace

In **OAuth & Permissions**, click **Install to Workspace**. After approving, you'll get a **Bot User OAuth Token** starting with `xoxb-`.

---

## Step 4 — Add credentials to your configuration

Open `.env` and add:

```ini
SLACK_BOT_TOKEN=xoxb-your-token-here
SLACK_SIGNING_SECRET=your-signing-secret-here
```

**Where is the signing secret?** In your Slack app settings, go to **Basic Information** → **App Credentials** → **Signing Secret**.

**What is the signing secret?** Similar to Telegram's webhook secret — it lets Manasvi verify that incoming events are genuinely from Slack.

---

## Step 5 — Make your server accessible

Like with Telegram, Slack needs to reach your Manasvi ingress service from the internet. Use a tunnel for local development:

```bash
ngrok http 4101
```

Copy the `https://` URL that ngrok shows.

---

## Step 6 — Enable event subscriptions

In your Slack app settings:

1. Go to **Event Subscriptions**
2. Enable events
3. Set the **Request URL** to: `https://your-ngrok-url/channels/slack/events`
4. Slack will verify the URL — Manasvi will respond with the verification challenge automatically
5. Under **Subscribe to bot events**, add `message.im` and `app_mention`
6. Save changes

---

## Step 7 — Test it

In Slack, send your bot a direct message or @mention it in a channel. It should respond via Manasvi.

---

## What Manasvi does with Slack messages

- Slack user IDs become principal identities (`slack:U01234ABC`)
- Manasvi verifies the Slack signing secret on every request
- Messages flow through the same full pipeline as any other channel
- Responses are sent back to the same Slack conversation

---

## Troubleshooting

**URL verification fails:** Make sure your ingress service is running and your tunnel is active.

**Bot doesn't respond:** Check the event subscription is saved and the bot is added to the channel.

**"Invalid signing secret":** Double-check `SLACK_SIGNING_SECRET` matches what Slack shows in Basic Information.
