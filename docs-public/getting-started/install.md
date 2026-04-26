---
sidebar_position: 3
title: Install Manasvi
description: Download and install Manasvi on your machine
---

# Install Manasvi

This guide walks you through downloading Manasvi and running the one-time setup command.

:::info Before you start
Make sure you've completed the [Prerequisites](/docs/getting-started/prerequisites) step. You need Node.js 20+, pnpm, and Git.
:::

## Step 1 — Download the code

```bash
git clone https://github.com/nishchay7pixels/manasvi.git
cd manasvi
```

## Step 2 — Install dependencies

```bash
corepack enable
pnpm install
```

This downloads all libraries Manasvi needs. It may take a minute or two the first time.

## Step 3 — Initialize

```bash
pnpm manasvi init
```

This single command does everything that used to require manual `.env` editing:

- Checks that your environment meets the prerequisites (Node.js, pnpm)
- Creates `~/.manasvi/` — the CLI home directory for config and logs
- Generates all required cryptographic secrets and writes them to `.env.local`
- Writes a default config file at `~/.manasvi/config.json`

You should see output like:

```
  Manasvi  init

  Checking prerequisites
  ✔ Node.js          v22.1.0
  ✔ pnpm             found
  ✔ tsx              found
  ✔ Manasvi project  /path/to/manasvi

  Setting up CLI home
  ✔ CLI home: /Users/you/.manasvi

  Generating secrets
  ✔ Generated 10 secrets → .env.local

  Done
  ✔ Manasvi initialized successfully

  Next steps:
  → Run pnpm manasvi onboard to configure your model provider and channels
  → Or run pnpm manasvi start to start with defaults (mock model mode)
```

:::tip Already have a `.env.local`?
`init` is safe to re-run. It preserves all existing secrets and only adds any that are missing. Pass `--force` to regenerate everything from scratch.
:::

---

## What `init` sets up

### Secrets (`.env.local`)

Manasvi signs and verifies internal messages with cryptographic keys. Rather than asking you to generate these by hand, `init` creates them for you:

| Secret | Purpose |
|--------|---------|
| `INTERNAL_AUTH_SIGNING_SECRET` | Signs tokens between services |
| `APPROVAL_SIGNING_KEYS` | Signs approval artifacts |
| `INTENT_SIGNING_SECRET` | Signs execution intents |
| `MEMORY_ENCRYPTION_KEY` | Encrypts untrusted memory stores |
| `AUDIT_INTEGRITY_KEY` | Protects the audit trail |
| …and more | All required secrets are covered |

In production, you would supply your own keys from a secrets manager. For local development, the generated values are sufficient.

### Config (`~/.manasvi/config.json`)

The CLI stores your preferences — model provider, enabled channels, docs UI settings — separately from the service `.env`. This means you can change what model you use without touching environment files.

---

## You're installed

Run `pnpm manasvi onboard` next to choose your model provider and connect a channel, or skip straight to `pnpm manasvi start` to run with the mock model for a quick look around.

Continue to [Run Locally](/docs/getting-started/run-locally).
