---
sidebar_position: 1
title: FAQ
description: Frequently asked questions about Manasvi
---

# Frequently Asked Questions

## General

### What is Manasvi?

Manasvi is a governed AI agent runtime. It provides the infrastructure to run AI agents that can take real-world actions — browsing the web, reading files, calling APIs, running commands — while keeping a human operator in control through policy-based authorization, human approval flows, and a complete audit trail.

### Who is Manasvi for?

Manasvi is for teams and individuals who want to deploy AI agents for consequential tasks — not just answering questions, but actually doing things. It's especially useful when you:

- Operate in a regulated or compliance-sensitive environment
- Want to give an AI agent access to sensitive resources without giving it unchecked authority
- Need a clear audit trail of what the agent did and why
- Want to extend the system with third-party integrations safely

### What channels does Manasvi support?

Out of the box: Telegram and a REST API. Slack support is in development. The ingress plane is designed to be extensible — you can add your own channel adapter.

### Is Manasvi a chatbot platform?

No. Manasvi is an agent runtime — it's designed for agents that take actions, not just respond with text. If you only need a chatbot, there are simpler tools. If you're building an agent that does things, Manasvi provides the governance layer that acting requires.

---

## Setup and Installation

### What do I need to run Manasvi?

- Node.js 20+
- pnpm
- A valid API key for your chosen AI model (Claude, OpenAI, etc.)
- (Optional) Telegram bot credentials if you want the Telegram adapter

See [Prerequisites](/docs/getting-started/prerequisites) for the full list.

### Can I run Manasvi locally?

Yes. The [Run Locally](/docs/getting-started/run-locally) guide walks through starting all services on your machine.

### Does Manasvi require any cloud services?

No. Manasvi runs entirely on your own infrastructure. The only outbound connections are to the AI model API you configure and any tools the agent uses (web search, etc.).

---

## Security

### How does Manasvi prevent the AI from doing things I didn't authorize?

Through the policy service. Every proposed tool call must pass a policy evaluation before an execution intent is issued. The policy service can deny actions, require human approval, or restrict what resources a tool can access.

The execution manager and node agents independently verify the signed intent before executing — they don't rely on the orchestrator's word.

### What is an execution intent?

A signed, time-limited authorization artifact that represents approval for a specific action. The signature is HMAC-SHA256 and covers all the action parameters. Any modification to the parameters changes the signature verification and the action is rejected. See [Execution Intent](/docs/concepts/execution-intent) for details.

### Can someone replay a valid approval to authorize a different action?

No. Approval artifacts are cryptographically bound to the specific execution intent they approve (by intent ID and payload hash). An approval for one action cannot authorize a different one — the payload hashes won't match.

Approval artifacts also include a unique nonce that is consumed on first use, preventing replay of the same artifact.

### What happens if the policy service is unavailable?

The default decision is `deny`. Manasvi is fail-closed — uncertainty defaults to not allowing the action.

### Can a plugin access my secrets?

Only if the plugin's manifest explicitly requests access to that specific secret, and you (as the operator) approved that capability grant. Plugins that didn't request `access-secret` for a specific secret name cannot access it.

---

## Customization

### Can I add my own tools?

Yes, via the plugin system. A plugin can declare new tools with custom manifests, inputs, and outputs. See [Plugins](/docs/concepts/plugins) for how this works.

### Can I configure what requires human approval?

Yes. The policy service supports per-tool, per-action-class, and per-resource approval requirements. You can require approval for shell commands globally, for file writes in specific directories, or for any other combination.

### Can I connect Manasvi to a different AI model?

Yes. The model provider is configurable. Manasvi supports `ollama`, `openai`, `claude`, and `mock` modes through the same provider abstraction.

---

## Operations

### Where are audit logs stored?

By default, locally on the machine running the services. The audit system is designed to support pluggable backends — external storage, SIEM integration, etc.

### How long are audit records retained?

Configurable per deployment. The default is to retain records indefinitely until manually cleared. For production use, you should configure an explicit retention policy.

### What happens if a node goes offline?

The node manager detects missed heartbeats and marks the node as unhealthy. New workloads won't be dispatched to it. When the node comes back online and resumes heartbeats, it's returned to healthy status automatically.

---

## Contributing

See the [Contributing Guide](/docs/contributing) for how to get involved.
