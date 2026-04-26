---
sidebar_position: 6
title: Use the Web UI and Terminal
description: Access Manasvi through the terminal chat and the documentation web UI
---

# Use the Web UI and Terminal

Manasvi comes with two built-in ways to interact without setting up a Telegram or Slack bot first.

---

## Terminal chat (`pnpm cli`)

The terminal chat is the fastest way to start talking to Manasvi. It opens an interactive session in your terminal.

### Start it

```bash
pnpm cli
```

You'll see:

```
Manasvi terminal  (session: session:abc123)
Type a message, or /help for commands.

You: 
```

Type a message and press Enter. The agent processes it through the full pipeline and responds.

### Terminal commands

| Command | Description |
|---------|-------------|
| `/help` | Show available commands |
| `/session` | Show your current session ID |
| `/new` | Start a new session |
| `/actor <id>` | Set your actor identity (e.g. `user:alice`) |
| `/exit` | Exit the terminal chat |

### How it works

The terminal chat connects to Manasvi's API gateway at `http://localhost:4100/test-harness/chat`. It maintains session state across messages, so the agent remembers context within a session.

Each message flows through the full governed pipeline:
1. Ingress normalizes the message
2. Orchestrator resolves the session and asks the model what to do
3. Policy evaluates any proposed actions
4. Execution happens in a sandbox (if tools are invoked)
5. Audit records everything

### Start with a different actor

To test with a specific user identity:

```bash
pnpm cli --actor user:alice
```

This is useful for testing policy rules that apply to specific users or roles.

---

## Documentation web UI

The docs web UI is a browsable version of the Manasvi documentation that runs locally.

### Enable it

During `pnpm manasvi onboard`, choose **Yes** when asked about the Web UI:

```
  Web UI & Docs
  ? Enable the documentation web UI?  Yes
  ✔ Docs UI will be available at http://localhost:3002
```

Or enable it in your config:

```bash
pnpm manasvi config edit
```

Set `ui.docsEnabled` to `true` and `ui.docsPort` to `3002` (or any available port).

### Start it

```bash
# Start the docs server (from the project root)
pnpm --filter @manasvi/docs-web start
```

Then open: [http://localhost:3002](http://localhost:3002)

### Open from the CLI

```bash
pnpm manasvi ui --open
```

This prints the docs URL and (with `--open`) opens it in your default browser.

---

## HTTP API (direct)

If you want to send messages programmatically or test from another tool:

```bash
curl -X POST http://localhost:4100/test-harness/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "What tools do you have?", "actor": "user:test"}'
```

Response:

```json
{
  "sessionId": "session:abc123",
  "response": {
    "text": "I have access to the following tools...",
    "model": "ollama/llama3.2"
  },
  "decisions": [
    {
      "action": "orchestration.ingress-event.plan",
      "outcome": "ALLOW"
    }
  ]
}
```

Pass `sessionId` in subsequent requests to maintain conversation context:

```bash
curl -X POST http://localhost:4100/test-harness/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "Tell me more.", "actor": "user:test", "sessionId": "session:abc123"}'
```

---

## Which interface to use?

| Interface | Best for |
|-----------|---------|
| Terminal chat (`pnpm cli`) | Quick testing, conversational exploration |
| HTTP API | Automated testing, integration with other tools |
| Telegram | Real-world use, mobile, production-like experience |
| Slack | Team workflows, production integration |
| Docs web UI | Browsing documentation offline or locally |
