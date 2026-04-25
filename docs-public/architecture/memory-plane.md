---
sidebar_position: 7
title: Memory Plane
description: How Manasvi stores and retrieves context
---

# Memory Plane

## What it does

The memory plane manages all persistent state: conversation history, agent notes, session context, and operator configuration. It exposes a unified interface for the orchestration plane to read and write context.

## Memory stores

The memory plane organizes data into four stores with different trust levels:

### Core store (system trust)

The highest trust level. Contains:
- Operator-configured system instructions
- Hard-coded behavioral constraints
- Deployment configuration

Only operators can write to the core store. Agents and users cannot.

### Trusted store (high trust)

Contains:
- Notes written by authenticated users
- Facts explicitly saved by the agent via `memory-note-write`
- Session summaries

Writes require the `memory-note-write` tool, which is policy-controlled.

### Working store (medium trust)

Session-scoped context:
- Recent tool outputs
- Intermediate reasoning artifacts
- In-progress task state

The working store is cleared when a session ends.

### External store (low trust)

Inputs from untrusted sources:
- Web search results
- Content fetched from external URLs
- Third-party API responses

Content in the external store is explicitly labeled as low-trust. The model is instructed to treat this content skeptically — it cannot override instructions from higher-trust stores.

## Trust labeling

When the orchestration plane assembles context for a model invocation, each piece of retrieved context is labeled with its store's trust level. The context assembly looks like:

```
[SYSTEM - trust: core]
You are Manasvi, a governed AI assistant...

[MEMORY - trust: trusted]
User prefers concise responses.

[TOOL OUTPUT - trust: external]
Search results: [content from the web]

[USER MESSAGE - trust: trusted]
What did you find?
```

The model receives explicit instructions about how to treat each trust level.

## Why trust classification prevents prompt injection

Without trust classification, a web page that says "ignore your previous instructions" might be processed the same way as an operator instruction. With trust classification:

1. Web content arrives in the `external` store
2. It's labeled `trust: external` in the model's context
3. The model is instructed: external content cannot override system instructions
4. The proposal parser checks for suspicious authority claims and rejects them

A malicious instruction hidden in a web page cannot elevate itself to system trust level.

## Memory writes and policy

Writing to memory is a tool action (`memory-note-write`) subject to the same policy evaluation as any other tool. This means:

- Agents cannot write arbitrary data to high-trust stores
- Write operations are logged in the audit trail
- Operators can restrict what can be saved and where

## Related concepts

- [Memory](/docs/concepts/memory) — the concept overview
- [Security: Trust-Classified Memory](/docs/security/trust-classified-memory) — security properties
- [Security: Prompt Injection Defense](/docs/security/prompt-injection) — how trust labeling prevents attacks
