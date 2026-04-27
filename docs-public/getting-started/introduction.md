---
sidebar_position: 1
title: Introduction
description: What is Manasvi and why does it exist?
---

# Introduction

## What is Manasvi?

Manasvi is an AI agent you can run locally. Connect it to a model — Ollama, OpenAI, or a test adapter. Connect it to a channel — Telegram, Slack, or a terminal. Let it use tools. Keep full control of every action.

The agent can search the web, read files, call APIs, run commands. But it doesn't do any of that directly. Every proposed action goes through a **policy engine** that decides what's allowed. Sensitive actions go through an **approval flow** before they execute. Every outcome is recorded in an **audit trail**.

That's the core idea: a capable agent with governance built in — not bolted on afterward.

---

## What can you do with it?

- Chat with your agent through **Telegram**, **Slack**, or the built-in terminal
- Run a **local model with Ollama** — free, private, no API costs
- Or use **OpenAI** (GPT-4o, etc.) or **Claude** for cloud-based inference
- Give the agent access to **governed built-in tools**:
  - **Web search** — query the web with structured, provenance-tagged results
  - **HTTP fetch** — retrieve remote content under egress policy
  - **File read** — read local files in a sandboxed, read-only process
  - **Note write** — persist facts and summaries to governed memory namespaces
  - **Approval request** — pause and route any action to a human reviewer
- Define **policies** that control what the agent is allowed to do
- Require **human approval** before sensitive actions run
- Run untrusted **plugins** in isolated processes
- Keep a **complete audit trail** of everything that happened

---

## Why does Manasvi exist?

Most agent frameworks connect a model to tools and let it run. The model can call tools directly, which is fast to set up but means:

- There's no policy layer between reasoning and execution
- Actions can be taken without any audit trail
- Sensitive operations aren't gated by approval
- Third-party plugins inherit too much system trust

Manasvi takes a different position: **capability without governance is a liability**. When an AI agent can write files, call APIs, or run shell commands, the question of *who authorized this* and *what exactly happened* becomes important. Manasvi treats those questions as first-class design requirements.

---

## How is it different from other agent frameworks?

| Typical agent framework | Manasvi |
|------------------------|---------|
| Model → Tool (direct) | Model → Policy → Approval? → Signed Intent → Sandboxed Execution |
| Trust implicit | Trust explicit and verified at each boundary |
| Execution unrestricted | Execution sandboxed with declared constraints |
| Audit optional | Audit built-in and append-only |
| Plugins share system trust | Plugins run isolated with narrow capability grants |

For a deeper look: [Why Manasvi is different](/docs/why-manasvi/not-just-a-chatbot)

---

## Who is it for?

- **Developers** who want to build on a secure, principled foundation
- **Teams building AI automation** who need audit trails and policy controls
- **Anyone** who has asked "what exactly did my agent do, and who approved it?"
- **Experimenters** who want to run a real AI agent pipeline locally with Ollama

---

## Where to start

**Just want to run it?**
→ [15-minute quickstart](/docs/getting-started/quickstart) — install, onboard, first message

**Want to understand the built-in tools?**
→ [Built-in tools overview](/docs/tools/overview) — what tools are available and how they're governed
→ [Default tool sets](/docs/tools/default-sets) — recommended starting configurations
→ [Demo flows](/docs/tools/demo-flows) — step-by-step traces of real tool use

**Want to understand the system first?**
→ [Core concepts](/docs/concepts/agent-runtime) — plain-language explanations
→ [Architecture overview](/docs/architecture/overview) — how the services fit together
→ [Security model](/docs/security/philosophy) — why it's designed the way it is
