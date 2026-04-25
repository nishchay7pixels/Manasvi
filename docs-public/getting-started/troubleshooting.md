---
sidebar_position: 6
title: Troubleshooting
description: Common problems and how to fix them
---

# Troubleshooting

Here are the most common issues people encounter and how to fix them.

---

## "Cannot find module" errors during build

**Symptom:** `pnpm build` fails with errors like `Cannot find module '@manasvi/contracts'`

**What it means:** The packages need to be built in the right order. Some packages depend on others.

**Fix:**
```bash
pnpm clean
pnpm install
pnpm build
```

This cleans old build artifacts and rebuilds everything from scratch.

---

## A service fails to start — "missing required config"

**Symptom:** A service crashes on startup with an error like `Missing required environment variable: INTERNAL_AUTH_KEY_ID`

**What it means:** Your `.env` file is missing a required setting.

**Fix:** Open your `.env` file and check that all required keys are present. Compare with `.env.example` to see what's needed.

At minimum you need:
```ini
INTERNAL_AUTH_KEY_ID=local-key-1
INTERNAL_AUTH_SIGNING_SECRET=some-long-random-string
INTERNAL_AUTH_VERIFICATION_KEYS=local-key-1:some-long-random-string
APPROVAL_SIGNING_KEYS=approval-k1:approval-secret
APPROVAL_SIGNING_KEY_ID=approval-k1
APPROVAL_VERIFICATION_KEYS=approval-k1:approval-secret
```

---

## Port already in use

**Symptom:** Error like `EADDRINUSE: address already in use :::4102`

**What it means:** Another process is already using that port.

**Fix:**

Find what's using it:
```bash
# macOS/Linux
lsof -i :4102

# Windows
netstat -ano | findstr :4102
```

Then either stop that process, or configure Manasvi to use a different port by setting `SERVICE_PORT` in your `.env`.

---

## "Invalid signature" errors

**Symptom:** Services reject requests with errors about invalid signatures or unknown key IDs.

**What it means:** The signing keys in your `.env` don't match between services. Manasvi uses HMAC keys to verify internal messages.

**Fix:** Make sure the `INTERNAL_AUTH_VERIFICATION_KEYS` value matches the `INTERNAL_AUTH_KEY_ID` and `INTERNAL_AUTH_SIGNING_SECRET` values. The format is `keyId:secret`.

Example — these must be consistent:
```ini
INTERNAL_AUTH_KEY_ID=my-key
INTERNAL_AUTH_SIGNING_SECRET=my-secret
INTERNAL_AUTH_VERIFICATION_KEYS=my-key:my-secret
```

---

## Model returns no response

**Symptom:** The agent responds with empty text or a timeout error.

**Cause A: OpenAI API key missing or invalid**

Check that `OPENAI_API_KEY` is set correctly in your `.env`. Try:
```bash
curl https://api.openai.com/v1/models \
  -H "Authorization: Bearer $OPENAI_API_KEY"
```

**Cause B: Ollama not running**

If you're using Ollama, make sure it's running:
```bash
ollama serve
```

And that your model is downloaded:
```bash
ollama list
```

**Cause C: Mock mode**

If `MODEL_ADAPTER_MODE=mock`, the agent uses test responses. This is fine for exploring the system, but won't generate real AI responses.

---

## Telegram messages not being received

**Symptom:** You send a message to your Telegram bot but Manasvi doesn't respond.

**Check 1: Is the webhook set?**
```bash
curl https://api.telegram.org/bot<YOUR_TOKEN>/getWebhookInfo
```

You should see your webhook URL in the response. If not, see [Connect Telegram](/docs/setup/connect-telegram) to set it up.

**Check 2: Is the ingress service running?**

Make sure the ingress service (port 4101) is running and accessible from the internet (you may need a tunnel like ngrok for local development).

---

## Still stuck?

If none of these help:

1. Check the service logs — look for `ERROR` or `WARN` lines
2. Make sure all services are running, not just some
3. Try `pnpm clean && pnpm build` to start fresh
4. Open an issue on [GitHub](https://github.com/nishchay7pixels/manasvi/issues) with your error output
