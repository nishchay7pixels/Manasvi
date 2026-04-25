---
sidebar_position: 1
title: Not Just a Chatbot
description: What makes an AI agent different from a chatbot, and why it matters for security
---

# Not Just a Chatbot

## The difference

A chatbot answers questions. An AI agent takes actions.

When you ask a chatbot "what's the weather in London?", it returns text. When you ask an AI agent the same thing, it might call a weather API, retrieve the data, parse it, and summarize it — all automatically.

This is qualitatively different. The chatbot's output is words. The agent's output is effects in the world.

## Why this distinction matters

A chatbot that says something wrong is a nuisance. An AI agent that does something wrong is a problem.

If an agent can search the web, it can be manipulated by malicious content on webpages. If it can send emails, a prompt injection attack could make it send emails to unintended recipients. If it can delete files, a misunderstood instruction could cause data loss.

Most AI deployments today treat agents like chatbots — they add tool-calling capabilities to a chat interface without adding the governance layer that agentic behavior requires. This is a security gap.

## What Manasvi adds

Manasvi is built for agentic use cases. It doesn't just add tool-calling — it adds the governance layer that agentic behavior requires:

- **Authorization**: Before any tool can be used, a policy must explicitly permit it
- **Human-in-the-loop**: Sensitive actions can require human approval before executing
- **Sandboxing**: Tools run in constrained environments that can't exceed their declared scope
- **Auditability**: Every action is recorded with full context for accountability

The model proposes. Manasvi governs.

## The trust gap

Many existing agent frameworks assume that because you configured the agent, you trust it completely. But there's a gap between "I configured this agent to have access to my email" and "I trust this agent to send any email it decides to send based on any instruction it receives."

Manasvi closes this gap. You can give the agent access to email while still requiring your approval before any email is sent. You can give the agent access to the web while ensuring it can only make calls to approved endpoints. Configuration and trust are separate concerns.

## When to use Manasvi

Manasvi is the right choice when:

- Your agent will take actions with real-world consequences
- You need accountability for what the agent did and why
- You operate in a regulated environment with compliance requirements
- You want to give the agent capabilities without giving it unchecked authority
- You want to extend the system with third-party plugins safely

If you just want a chatbot, there are simpler tools. If you're building an agent that acts, Manasvi provides the governance layer that action requires.

## Related pages

- [Policy-Governed Agents](/docs/why-manasvi/policy-governed)
- [Execution Separation](/docs/why-manasvi/execution-separation)
- [Security: Philosophy](/docs/security/philosophy)
