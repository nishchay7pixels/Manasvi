---
sidebar_position: 1
title: Introduction
description: What is Manasvi and why does it exist?
---

# Introduction

## What is Manasvi?

Manasvi is an **AI agent operating fabric** — a system designed to run AI agents in a way that is secure, auditable, and governable by design.

Think of it as the infrastructure layer between your AI model and the real world. When an AI agent wants to send an email, read a file, make an API call, or execute a command, Manasvi decides:

- **Is this action allowed?** (policy evaluation)
- **Does someone need to approve it first?** (approval workflow)
- **Where should it execute, and under what constraints?** (sandboxed runtime)
- **Was it recorded for accountability?** (audit trail)

None of that happens by accident. Every step is intentional.

## Why does Manasvi exist?

Most AI agent frameworks are optimized for capability — making it easy to connect a model to tools and let it run. Manasvi takes a different position: **capability without governance is a liability**.

When AI agents can execute real-world actions — writing files, calling APIs, managing data, running shell commands — the question of *who approved this* and *what exactly happened* becomes critical. Manasvi treats those questions as first-class design requirements, not afterthoughts.

## Who is it for?

Manasvi is useful for:

- **Teams building AI automation** who need audit trails and policy controls
- **Organizations deploying agents** in contexts where mistakes have real consequences
- **Developers** who want to build on a principled, secure foundation rather than retrofitting security later
- **Anyone** who has asked "how do I know what my agent actually did?"

## What can I do with it?

With Manasvi you can:

- Connect AI models to tools (web search, file access, HTTP calls, shell execution)
- Receive and respond to messages through channels like **Telegram** and **Slack**
- Define policies that control what agents are allowed to do
- Require human approval before sensitive actions execute
- Run untrusted plugins in isolated processes
- Dispatch work to remote execution nodes
- Keep a complete, tamper-resistant record of everything that happened

## How is it different from other agent frameworks?

The short answer: most frameworks connect a model to tools. Manasvi connects a model to a **governance layer** that controls tool access.

| Typical agent framework | Manasvi |
|------------------------|---------|
| Model → Tool (direct) | Model → Policy → Approval? → Signed Intent → Verified Execution |
| Trust implicit | Trust explicit and verified |
| Execution unrestricted | Execution sandboxed with declared constraints |
| Audit optional | Audit built-in and append-only |
| Plugins trusted | Plugins isolated and capability-gated |

For a deeper look at these differences, see [Why Manasvi](/docs/why-manasvi/not-just-a-chatbot).

## Where do I start?

If you want to get Manasvi running:

1. Check [Prerequisites](/docs/getting-started/prerequisites) to make sure your system is ready
2. Follow the [Install guide](/docs/getting-started/install)
3. [Run it locally](/docs/getting-started/run-locally) and try your first workflow

If you want to understand the system first:

- [Core concepts](/docs/concepts/agent-runtime) — plain-language explanations of each component
- [Architecture overview](/docs/architecture/overview) — how the services fit together
- [Security model](/docs/security/philosophy) — why it's designed the way it is
