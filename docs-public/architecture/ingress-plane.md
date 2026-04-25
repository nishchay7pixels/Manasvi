---
sidebar_position: 2
title: Ingress Plane
description: How messages enter Manasvi from external channels
---

# Ingress Plane

## What it does

The ingress plane is the entry point for all messages. It accepts incoming communication from external channels — Telegram, Slack, a REST API, or any other adapter — and normalizes them into a consistent internal format before forwarding to the orchestration plane.

## Responsibilities

- **Receive** — accept messages from external channels via webhooks or polling
- **Authenticate** — verify the sender's identity (Telegram user ID, Slack user ID, API key, etc.)
- **Normalize** — convert channel-specific message formats into the internal `IncomingMessage` schema
- **Route** — send the normalized message to the orchestrator for processing
- **Reply** — accept the orchestrator's response and deliver it back through the correct channel

## Channel adapters

Each supported channel has its own **adapter** — a thin translation layer that handles the specifics of that channel's API:

| Adapter | Protocol | Notes |
|---------|----------|-------|
| Telegram | Webhook (HTTP POST) | Message types: text, voice, documents |
| Slack | Events API | Slash commands and direct messages |
| HTTP API | REST | Programmatic access |

Adapters are responsible for channel-specific concerns only. They don't make decisions about what to do with a message — that's the orchestrator's job.

## The normalized message

After an adapter processes a raw message, it emits a normalized structure that includes:

- **Actor** — who sent the message (user ID, channel, trust level)
- **Content** — the message text or media
- **Session ID** — the conversation context
- **Channel metadata** — source adapter, timestamp, message ID

This normalization means the orchestration plane doesn't need to know whether a message came from Telegram or Slack — it sees the same structure regardless.

## Ingress security

The ingress plane is the first line of defense against:

- **Unauthenticated requests** — messages without valid authentication are rejected before reaching the orchestrator
- **Oversized payloads** — message size is bounded to prevent abuse
- **Invalid formats** — malformed messages are rejected at the adapter level

Importantly, the ingress plane does **not** trust the content of messages. The fact that a message arrived from an authenticated Telegram user doesn't mean the message's content is trustworthy. Content trust is evaluated at a different layer.

## Related concepts

- [Sessions](/docs/concepts/sessions) — how conversations are scoped
- [Architecture: Orchestration Plane](/docs/architecture/orchestration-plane) — what happens after ingress
