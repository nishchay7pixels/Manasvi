---
sidebar_position: 7
title: Sessions
description: How Manasvi scopes conversations and manages context
---

# Sessions

## What is a session?

A session is a bounded conversation context — a container that groups a series of messages, tool calls, and results into a single coherent interaction.

When you send Manasvi a message, it's associated with a session. The session tracks:

- The conversation history for that interaction
- The active user or actor
- The ingress channel (Telegram, Slack, API, etc.)
- Session-scoped memory and state

## Why sessions exist

Sessions serve two purposes: **context management** and **security scoping**.

**Context management**: The model needs recent history to answer coherently. Sessions give the agent runtime a defined scope to load history from — it doesn't have to search through everything ever said to everyone.

**Security scoping**: Policies and approvals are evaluated in the context of a session. Who is the actor? What channel are they on? What have they already approved in this conversation? These facts come from the session.

## Session lifecycle

```
created → active → idle → closed
```

Sessions are created when a message arrives through an ingress channel. They're closed explicitly or after an inactivity timeout. A closed session's history is preserved in the audit trail but is no longer the active context for new messages.

## Session vs. conversation history

Sessions are the container; conversation history is the content. A long-running project might span multiple sessions — the history persists in the memory system, but each session has its own active context window.

## How sessions affect the agent

When the agent runtime assembles context for the model, the session determines:

- Which recent messages to include
- What the actor's identity and permissions are
- Which approvals have already been granted in this conversation
- What channel-specific constraints apply

A message coming through the Telegram adapter is processed in a different session context than a message from the API — even if it's the same user. Channel-specific policies can apply different rules.

## Related concepts

- [Memory](/docs/concepts/memory) — what persists across sessions
- [Agent Runtime](/docs/concepts/agent-runtime) — how sessions feed into the planning loop
