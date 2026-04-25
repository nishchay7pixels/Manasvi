---
sidebar_position: 1
title: Security Philosophy
description: The principles behind Manasvi's security design
---

# Security Philosophy

## The core problem

AI agents are fundamentally different from traditional software in ways that make standard security approaches inadequate.

Traditional software does exactly what you programmed it to do. If there's a security problem, it's in the code, and you can find and fix it.

AI agents are different: they take instructions from external inputs (user messages, retrieved documents, tool outputs), interpret those instructions dynamically, and decide what to do. This means:

- The "code" running the agent's logic isn't static — it's the model's interpretation of a prompt
- Malicious content in retrieved data can influence what the agent decides to do
- The agent might take consequential actions (send an email, delete a file, call an API) based on content you don't control

Standard security approaches don't cover this. Manasvi's security model is designed for this environment.

## Our principles

### 1. The model proposes; humans govern

The AI model is a reasoning engine, not a decision authority. It can suggest actions, but those suggestions must pass through a governance layer before anything happens. The model does not have direct access to tools, files, or external systems.

### 2. Fail closed

When something is uncertain, deny. If the policy service is unreachable, deny. If the intent signature doesn't verify, deny. If the payload hash doesn't match, deny. The default is safe.

### 3. Defense in depth

No single control is relied upon exclusively. Authorizations are signed cryptographically **and** checked for expiration **and** verified against a payload hash **and** checked for replay. Multiple independent checks must all pass.

### 4. Least privilege by design

Tools declare exactly what they need (network access, filesystem paths, etc.). The sandbox enforces those declarations — a tool cannot access resources it didn't declare, even if the model asks it to. Plugins must explicitly request capabilities.

### 5. Trust is explicit, not assumed

Content from the internet is not trusted because it arrived over HTTPS. A plugin is not trusted because it has a well-crafted manifest. Trust is declared, bounded, and verified — never assumed from provenance.

### 6. Auditability as a security control

Every decision, authorization, and action is recorded. This serves two purposes: accountability after the fact, and deterrence (behaviors that would be visible in the audit trail are less likely to occur).

## What this means for operators

Manasvi is designed to be run by operators who have specific requirements — compliance constraints, data residency needs, sensitivity thresholds. The security model gives you levers to configure, not just default behaviors to accept.

You can:
- Define what actions require human approval
- Restrict tools to specific resources or network allowlists
- Configure different policies for different users or channels
- Require approval from a separate channel (not the user themselves)

## Related pages

- [Zero Trust Design](/docs/security/zero-trust)
- [Policy-First Architecture](/docs/security/policy-first)
- [Why Manasvi?](/docs/why-manasvi/not-just-a-chatbot)
