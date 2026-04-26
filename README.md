# Manasvi

A governed AI agent runtime. AI agents that take real-world actions — with policy-based authorization, human approval flows, and a complete audit trail.

## Install

```bash
git clone <repo-url>
cd manasvi
corepack enable
pnpm install
```

## Quick start

```bash
pnpm manasvi init        # Initialize and generate secrets
pnpm manasvi onboard     # Configure model provider and channels
pnpm manasvi start       # Start all services
pnpm manasvi status      # Check health
```

Having trouble? Run `pnpm manasvi doctor` to diagnose issues.

## CLI reference

| Command | Description |
|---------|-------------|
| `manasvi init` | Initialize Manasvi locally |
| `manasvi onboard` | Guided setup (model, channels, prefs) |
| `manasvi start` | Start all services |
| `manasvi stop` | Stop all services |
| `manasvi status` | Health and configuration overview |
| `manasvi doctor` | Diagnose setup issues |
| `manasvi ui` | Open the documentation UI |
| `manasvi models list` | View/configure model providers |
| `manasvi channels list` | View/configure channels |
| `manasvi tools list` | View available tools |
| `manasvi config show` | Show full configuration |

Run `pnpm manasvi --help` for the full command tree.

## Model providers

Manasvi supports:

- **Ollama** — run models locally (`ollama serve` + `ollama pull llama3.2`)
- **OpenAI** — use GPT models via API key
- **Mock** — simulated responses for testing

Configure via `pnpm manasvi models add` or during `pnpm manasvi onboard`.

## Channels

- **Telegram** — bot API (polling mode, no server needed)
- **Slack** — Events API
- **Terminal** — `pnpm cli` for interactive terminal chat
- **HTTP API** — `http://localhost:4100/test-harness/chat`

Configure via `pnpm manasvi channels add`.

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

Full documentation: `pnpm manasvi ui` or `cd apps/docs-web && pnpm start`.

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

## Contributing

See [docs-public/contributing.md](./docs-public/contributing.md) for guidelines.
