---
sidebar_position: 6
title: Troubleshooting
description: Common problems and how to fix them
---

# Troubleshooting

## Run the doctor first

Before diving into manual checks, run:

```bash
pnpm manasvi doctor
```

The doctor command checks Node.js version, pnpm, configuration, secrets, port availability, service health, and model backend connectivity. It outputs a diagnosis table with actionable fixes for each problem it finds.

---

## "Cannot find module" errors during build

**Symptom:** `pnpm build` fails with errors like `Cannot find module '@manasvi/contracts'`

**Fix:**
```bash
pnpm clean
pnpm install
pnpm build
```

This cleans old build artifacts and rebuilds from scratch.

---

## Services fail to start — "missing required config"

**Symptom:** A service crashes with `Missing required environment variable: INTERNAL_AUTH_KEY_ID`

**Cause:** Your `.env.local` file is missing a required secret.

**Fix:** Re-run init, which adds any missing secrets without overwriting existing ones:
```bash
pnpm manasvi init
```

If you want to see which secrets are missing, run `pnpm manasvi doctor` — it checks for the presence of all required keys.

---

## Port already in use

**Symptom:** Error like `EADDRINUSE: address already in use :::4102`

**Quick check:**
```bash
pnpm manasvi doctor
```

The doctor shows port availability for all nine services.

**Manual check:**
```bash
# macOS / Linux
lsof -i :4102

# Windows
netstat -ano | findstr :4102
```

If a previous Manasvi run left orphaned processes, try a graceful stop first:
```bash
pnpm manasvi stop
pnpm manasvi start
```

If services are stuck and won't respond to SIGTERM:
```bash
pnpm manasvi stop --force
pnpm manasvi start
```

`--force` sends SIGKILL to any service that doesn't exit within 5 seconds.

---

## "Invalid signature" errors

**Symptom:** Services reject requests with errors about invalid signatures or unknown key IDs.

**Cause:** Signing keys in `.env.local` are inconsistent between services. All services share the same file, so this usually means the file was partially edited by hand.

**Fix:** Let init regenerate the signing key set:
```bash
pnpm manasvi init --force
```

Or verify manually — these three values must match:
```ini
INTERNAL_AUTH_KEY_ID=my-key
INTERNAL_AUTH_SIGNING_SECRET=my-secret
INTERNAL_AUTH_VERIFICATION_KEYS=my-key:my-secret
```

---

## Model returns no response / timeout

**Cause A: Mock mode**

Check your current model:
```bash
pnpm manasvi status
```

If `Model: Mock (testing mode)`, the agent uses canned responses. To switch to a real model:
```bash
pnpm manasvi models use ollama
# or
pnpm manasvi models use openai
```

**Cause B: Ollama not running**

```bash
pnpm manasvi doctor
# Look for "Model backend" in the output

# Start Ollama
ollama serve
```

**Cause C: OpenAI key missing or invalid**

```bash
pnpm manasvi models test
```

This sends a test request and shows the error if the key is wrong.

---

## Telegram messages not being received

**Symptom:** You message your Telegram bot but get no response.

**Check 1: Is the ingress service running?**
```bash
pnpm manasvi status
# Look for ingress-service :4101
```

**Check 2: Is Telegram configured?**
```bash
pnpm manasvi channels status
```

**Check 3: Is the bot token correct?**
```bash
pnpm manasvi channels remove telegram
pnpm manasvi channels add telegram
```

Re-add the channel to re-enter the token.

For local development, Telegram needs a publicly reachable URL. Use a tunnel like ngrok and configure `TELEGRAM_WEBHOOK_URL` in your `.env.local`. The ingress service uses polling mode by default, which does not require a public URL.

---

## Init says "already initialized"

Run with `--force` to reinitialize:
```bash
pnpm manasvi init --force
```

This regenerates all secrets and rewrites the config. Existing values in `.env.local` will be overwritten.

---

## Still stuck?

1. Run `pnpm manasvi doctor` and read each failed check
2. Check the service logs: `~/.manasvi/logs/<service-name>.log`
3. Run `pnpm manasvi status --verbose` for PID information
4. Open an issue on [GitHub](https://github.com/nishchay7pixels/manasvi/issues) with your error output and the doctor output
