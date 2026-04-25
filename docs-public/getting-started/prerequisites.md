---
sidebar_position: 2
title: Prerequisites
description: What you need before installing Manasvi
---

# Prerequisites

Before you install and run Manasvi, you need a few things set up on your computer. This page explains each one in plain language.

## What you'll need

### 1. Node.js (version 18 or newer)

**What it is:** Node.js is the software that runs JavaScript on your computer. Manasvi is built with TypeScript, which runs on Node.js.

**How to check if you have it:**
```bash
node --version
```
If you see something like `v20.11.0`, you're good. If you see an error or a version below 18, you need to install it.

**How to get it:** Visit [nodejs.org](https://nodejs.org) and download the LTS version. Run the installer. Done.

---

### 2. pnpm (package manager)

**What it is:** pnpm is a tool that installs the libraries Manasvi depends on. It's similar to npm or yarn, but designed for large monorepos like Manasvi.

**How to check:**
```bash
pnpm --version
```

**How to get it:**
```bash
corepack enable
corepack prepare pnpm@latest --activate
```

> **What is corepack?** Corepack comes with Node.js 16.9+. It manages package manager versions automatically. Running `corepack enable` is enough.

---

### 3. Git

**What it is:** Git is used to download the Manasvi source code from GitHub.

**How to check:**
```bash
git --version
```

**How to get it:** Visit [git-scm.com](https://git-scm.com/downloads) and follow the instructions for your operating system.

---

### Optional: An AI model provider

Manasvi needs access to a language model to generate responses. You have two options:

**Option A: OpenAI (or any OpenAI-compatible API)**

You'll need an API key from [platform.openai.com](https://platform.openai.com). If you have one, Manasvi will use it automatically.

**Option B: Ollama (local model, no API key needed)**

[Ollama](https://ollama.com) lets you run AI models locally on your computer. It's free and private — the model runs on your machine.

To install Ollama and pull a model:
```bash
# Install Ollama from https://ollama.com
ollama pull llama3.2
```

If you're just experimenting, Manasvi includes a **mock adapter** that works without any model. It returns predictable test responses so you can explore the system without connecting to a real AI provider.

---

### Optional: A Telegram or Slack account

If you want Manasvi to respond to messages from Telegram or Slack, you'll need:

- **Telegram:** A Telegram account and a bot token (explained in [Connect Telegram](/docs/setup/connect-telegram))
- **Slack:** A Slack workspace and a Slack app (explained later in the setup guides)

You can also test Manasvi through the API directly without setting up a channel first.

---

## System requirements

| Requirement | Minimum |
|------------|---------|
| Node.js | 18.0 or newer |
| RAM | 2 GB (4 GB recommended) |
| Disk | 1 GB free |
| OS | macOS, Linux, or Windows with WSL2 |

---

## You're ready

Once you have Node.js, pnpm, and Git, you're ready to install Manasvi. Continue to [Install](/docs/getting-started/install).
