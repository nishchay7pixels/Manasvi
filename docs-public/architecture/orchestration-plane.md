---
sidebar_position: 3
title: Orchestration Plane
description: The governance layer between model output and execution
---

# Orchestration Plane

## What it does

The orchestration plane is the brain and the conscience of Manasvi. It takes incoming messages, runs the planning loop, and ensures every proposed action goes through authorization before anything happens.

This is the governance layer — the component that separates "the model wants to do X" from "X is actually allowed to happen."

## Components

### Agent Runtime

The agent runtime runs the planning loop:

1. Assembles conversation context with trust labels
2. Invokes the AI model
3. Parses the model's response into structured proposals
4. Validates proposals for suspicious patterns
5. Routes proposals to policy evaluation
6. Issues signed execution intents for approved actions
7. Waits for results and continues the loop

The runtime has strict limits: maximum iterations, maximum consecutive errors, and timeout bounds. It cannot run indefinitely.

### Policy Service

The policy service answers the question: **is this action allowed?**

It evaluates each proposal against the configured policy rules and returns one of three decisions:
- `allow` — proceed
- `allow_with_approval` — proceed after human sign-off
- `deny` — reject

The policy service is fail-closed: if it can't evaluate a request, the answer is `deny`.

### Approval Flow

When policy returns `allow_with_approval`, the approval flow:

1. Creates a signed approval request artifact
2. Routes the request to the appropriate channel (same conversation, admin channel, etc.)
3. Waits for a human response
4. Verifies the response is authentic and not expired
5. Returns control to the agent runtime

Approval artifacts are cryptographically bound to the specific action being approved. They cannot be transferred or replayed.

## Why the orchestration plane matters

In most agent frameworks, the model directly decides to call a tool and the framework calls it. There's no layer in between that asks: "should this be allowed?"

The orchestration plane inserts that layer. Every tool call must pass through:

1. **Proposal parsing** — is this a well-formed request?
2. **Suspicious pattern detection** — is this trying to claim authority it wasn't given?
3. **Policy evaluation** — is this actually permitted?
4. **Intent issuance** — what is being authorized, exactly?

None of these steps can be skipped by the model. The model proposes; the orchestration plane decides.

## Prompt injection protection

The orchestration plane specifically defends against prompt injection — malicious content in retrieved documents that tries to hijack the agent's behavior.

Protections include:

- External content is labeled as low-trust and the model is instructed to treat it skeptically
- Proposals that claim authority not established in the system context are rejected
- The proposal parser looks for specific suspicious patterns (claims of pre-approval, attempts to override system instructions)

## Related concepts

- [Agent Runtime](/docs/concepts/agent-runtime) — detailed planning loop description
- [Policies](/docs/concepts/policies) — how authorization decisions are made
- [Approvals](/docs/concepts/approvals) — the human sign-off flow
- [Architecture: Policy Service](/docs/architecture/policy-service) — policy service internals
