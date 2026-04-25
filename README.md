# Manasvi

A governed AI agent runtime. Run AI agents that take real-world actions — with policy-based authorization, human approval flows, and a complete audit trail.

## What Manasvi does

Manasvi is an **agent runtime with a governance layer**. It lets AI agents use tools (search the web, read files, call APIs, run commands) while keeping a human operator in control of what's actually permitted.

The core idea: the AI model proposes actions. Manasvi decides whether and how to execute them.

- **Policy-gated execution** — every tool call passes a policy evaluation before anything happens
- **Human-in-the-loop approvals** — sensitive actions can require human sign-off, cryptographically bound to the specific action
- **Sandboxed tools** — tools run in constrained environments and can't exceed their declared scope
- **Full audit trail** — every decision, approval, and execution is recorded with trace linkage

## Quick start

```bash
corepack enable
pnpm install
cp .env.example .env.local   # fill in required values
pnpm dev
```

See the [documentation](./apps/docs-web) or run the docs site locally:

```bash
cd apps/docs-web
pnpm install
pnpm start
```

## Architecture overview

```
Ingress (Telegram, Slack, API)
    ↓  normalized message
Orchestration (agent runtime, policy service, approval flow)
    ↓  signed execution intent
Execution (sandbox runtime, tool dispatch)
    ↓  (optional)
Remote nodes (node manager, node agents)
```

Supporting services: memory plane (trust-classified stores), extension plane (plugin lifecycle), audit service.

## Service ports (local)

| Service | Port |
|---------|------|
| api-gateway | 4100 |
| ingress-service | 4101 |
| orchestrator-service | 4102 |
| policy-service | 4103 |
| execution-manager | 4104 |
| memory-service | 4105 |
| node-manager | 4106 |
| audit-service | 4107 |
| approval-service | 4108 |

## Repository layout

```
apps/          deployable services
packages/      shared libraries and SDKs
docs-public/   public documentation content
docs-internal/ internal design specs and progress notes
```

## Documentation

Full documentation lives in [docs-public/](./docs-public/) and is served by the Docusaurus site in [apps/docs-web/](./apps/docs-web/).

Key reading:
- [Getting Started](./docs-public/getting-started/introduction.md)
- [Core Concepts](./docs-public/concepts/agent-runtime.md)
- [Architecture Overview](./docs-public/architecture/overview.md)
- [Security Model](./docs-public/security/philosophy.md)
