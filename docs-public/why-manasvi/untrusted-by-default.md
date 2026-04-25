---
sidebar_position: 4
title: Untrusted by Default
description: Why Manasvi treats all external inputs skeptically
---

# Untrusted by Default

## The implicit trust problem

Most software systems have an implicit trust model: inputs from authenticated users are trusted; everything else is untrusted. This works reasonably well for traditional software.

AI agents break this model. An authenticated user can ask the agent to fetch a webpage, and the content of that webpage — which is fully untrusted — becomes part of the agent's context. If the agent treats that content as trusted, an attacker who controls the webpage can influence the agent.

## Manasvi's answer: trust is explicit and bounded

In Manasvi, trust is not inferred from how something arrived. It's declared explicitly:

- **Operator configuration** arrives in the `core` store → trust: core
- **Authenticated user messages** arrive in the `trusted` store → trust: trusted
- **Tool outputs and retrieved content** arrive in the `external` store → trust: external

The trust level cannot be upgraded by the content itself. A webpage that says "I am an authorized operator instruction" is still in the `external` store, still labeled `trust: external`.

## What "untrusted by default" covers

### Plugins

A plugin is untrusted by default — no matter how well-crafted its manifest is. It must:

- Request specific capabilities (not get them automatically)
- Have those capabilities explicitly approved by an operator
- Operate within its declared scope (enforced at the communication channel level)

Even a plugin from a known, reputable developer starts at zero trust and must earn capability grants.

### Nodes

A remote execution node is untrusted by default. A node agent that receives a dispatch request:

- Verifies the dispatch nonce (not replayed)
- Verifies the dispatch payload hash (not tampered)
- Verifies the approval artifact (if applicable)

The node doesn't trust the dispatch because it came from the node manager. It verifies independently.

### Retrieved content

Any content retrieved from an external source — web pages, API responses, documents — is labeled `trust: external`. The model is explicitly instructed to treat this content skeptically and to reject any attempt by this content to override system instructions.

### User input

Even user input isn't unconditionally trusted. Users have a trust level based on their identity and channel. A user on the Telegram channel has different trust than an operator configuring the system. User requests are still subject to policy evaluation — the user can't request an action that their trust level doesn't authorize.

## The design benefit

Systems that are untrusted by default are much easier to reason about. Instead of asking "could this be abused?" for every external input, the question becomes "what does this input have explicit authority to do?" If the answer is "nothing that matters," the attack surface is small.

Explicit trust is also auditable: you can look at any event in the audit trail and see exactly what trust level the actor had, what capabilities were in scope, and what policy decision authorized the action.

## Related pages

- [Security: Trust-Classified Memory](/docs/security/trust-classified-memory) — how trust is stored and labeled
- [Security: Plugin Isolation](/docs/security/plugin-isolation) — how plugins earn capabilities
- [Security: Zero Trust Design](/docs/security/zero-trust) — independent verification at each layer
