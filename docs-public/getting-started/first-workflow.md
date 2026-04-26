---
sidebar_position: 5
title: First Workflow
description: Walk through your first end-to-end agent interaction
---

# Your First Workflow

This page walks through what actually happens when you send Manasvi a message — so you understand what the system is doing, not just that it works.

:::info Start everything first
Make sure all services are running. See [Run Locally](/docs/getting-started/run-locally) or [Quickstart](/docs/getting-started/quickstart) if you haven't done that yet.
:::

---

## Start the terminal chat

```bash
pnpm cli
```

You'll see a prompt like:

```
Manasvi terminal  (session: session:abc123)
Type a message, or /help for commands.

You: 
```

---

## Send a simple message

```
You: What can you help me with?
```

The agent will respond with its capabilities. Behind the scenes, here's what happened:

1. **Ingress** received your message, verified the source, and normalized it into an internal format
2. **Orchestrator** resolved your identity, retrieved any existing session context, and sent the message to the model
3. The **model** generated a response — just conversational text, no tool calls needed
4. **Policy** evaluated the interaction (even a simple reply is recorded)
5. **Audit** recorded the full event

That all happened in the time it took to get a response.

---

## Ask the agent to use a tool

```
You: Search for recent news about AI safety
```

Now the full pipeline activates:

1. The **model** decides it needs the web search tool to answer properly
2. It outputs a **tool call proposal** — a structured request like "search for: AI safety news"
3. The **policy engine** evaluates: is this tool call allowed for this user?
4. If allowed, an **execution intent** is created and cryptographically signed
5. The **execution manager** verifies the signature before running anything
6. The tool executes in a **sandboxed environment** with declared constraints
7. The result flows back to the model, which formulates a response
8. **Audit** records every step: the proposal, the policy decision, the intent, the execution, the outcome

**Why this matters:** The model never calls the tool directly. It proposes, and a separate system decides whether and how to execute. This separation is what makes governance possible.

---

## Try a multi-turn conversation

```
You: That's interesting. What else do you know about AI governance?
Agent: [responds with context from the previous message]

You: Can you summarize the key points in a list?
Agent: [uses previous context to give a structured answer]
```

Manasvi maintains session context across turns. The orchestrator retrieves relevant memory before each model call, so the agent remembers what you were discussing.

---

## What gets recorded

Everything you just did was recorded in the audit trail. To see it:

```bash
curl http://localhost:4107/audit/events?limit=20
```

You'll see entries for:
- Messages received by ingress
- Policy decisions (even the routine "allow" ones)
- Tool invocations (if any)
- Agent responses

The audit trail is append-only. Events can't be modified or deleted after they're written.

---

## Next steps

Now that you've seen the pipeline working:

- **Connect Telegram** — get mobile chat with your agent
  → [Connect Telegram](/docs/setup/connect-telegram)

- **Connect Ollama** — run a local model for privacy and no API costs
  → [Connect Ollama](/docs/setup/connect-ollama)

- **Connect Claude** — run with Anthropic Claude as your cloud model provider
  → [Connect Claude](/docs/setup/connect-claude)

- **Understand the concepts** — learn what each part does in plain language
  → [Core concepts](/docs/concepts/agent-runtime)

- **See the architecture** — understand how the services fit together
  → [Architecture overview](/docs/architecture/overview)
