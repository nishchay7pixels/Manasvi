---
sidebar_position: 4
title: Run Locally
description: Start all Manasvi services and verify they are running
---

# Run Manasvi Locally

Once you've run `pnpm manasvi init`, starting everything is a single command.

## Start all services

```bash
pnpm manasvi start
```

The CLI starts all nine services in dependency order, waits for each one to pass its health check, and prints a status table when everything is ready:

```
  Manasvi  start

  Starting services
  ✔ policy-service        ready  (312ms)
  ✔ approval-service      ready  (284ms)
  ✔ memory-service        ready  (341ms)
  ✔ audit-service         ready  (298ms)
  ✔ execution-manager     ready  (356ms)
  ✔ node-manager          ready  (270ms)
  ✔ orchestrator-service  ready  (489ms)
  ✔ ingress-service       ready  (301ms)
  ✔ api-gateway           ready  (278ms)

  ✔ All 9 services healthy

  Next steps:
  → Chat via terminal:  pnpm cli
  → Check status:       pnpm manasvi status
  → API endpoint:       http://localhost:4100/test-harness/chat
```

Service logs are written to `~/.manasvi/logs/<service-name>.log`.

---

## Check status

At any time, run:

```bash
pnpm manasvi status
```

This shows each service's health, latency, and your current configuration:

```
  Services
  API Gateway           :4100   ● healthy (12ms)
  Ingress Service       :4101   ● healthy (9ms)
  Orchestrator          :4102   ● healthy (14ms)
  Policy Service        :4103   ● healthy (8ms)
  Execution Manager     :4104   ● healthy (11ms)
  Memory Service        :4105   ● healthy (10ms)
  Node Manager          :4106   ● healthy (9ms)
  Audit Service         :4107   ● healthy (8ms)
  Approval Service      :4108   ● healthy (9ms)

  ✔ All 9 services healthy

  Configuration
  Profile    local
  Model      Mock (testing mode)
  Channels   none
  Docs UI    http://localhost:3000
```

---

## Send a test message

### Option A — Interactive terminal

```bash
pnpm cli
```

This opens an interactive REPL that sends messages through the API gateway. Type a message and press Enter to chat with the agent.

```
Manasvi terminal  (session: session:abc123)
Type a message, or /help for commands.

You: What can you help me with?
Agent: I can help you with...
```

### Option B — Direct API call

```bash
curl -X POST http://localhost:4100/test-harness/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "Hello, what tools do you have?", "actor": "user:test"}'
```

---

## Stop services

```bash
pnpm manasvi stop
```

Sends SIGTERM to each running service and waits up to 5 seconds for it to exit cleanly. If a service doesn't stop in time, it prints an error and exits with a non-zero code.

If services are hung and won't stop gracefully, use `--force` to send SIGKILL:

```bash
pnpm manasvi stop --force
```

To restart all services:

```bash
pnpm manasvi restart

# Or force-kill stuck services then restart:
pnpm manasvi restart --force
```

---

## Service ports reference

| Service | Port | Purpose |
|---------|------|---------|
| api-gateway | 4100 | Public entry point |
| ingress-service | 4101 | Channel message intake |
| orchestrator-service | 4102 | Agent runtime and planner |
| policy-service | 4103 | Authorization decisions |
| execution-manager | 4104 | Tool validation and execution |
| memory-service | 4105 | Context and memory storage |
| node-manager | 4106 | Remote node management |
| audit-service | 4107 | Audit trail |
| approval-service | 4108 | Approval workflow |

---

## What happens when you send a message

1. **Ingress** receives the message, normalizes it, verifies the source
2. **Orchestrator** resolves your identity, retrieves session context, asks the model what to do
3. **Policy** evaluates whether any proposed action is allowed
4. **Approval service** handles actions that require human sign-off
5. **Execution manager** validates the signed intent and runs the action in a sandbox
6. **Memory** stores the outcome for future context
7. **Audit** records everything that happened

Continue to [First Workflow](/docs/getting-started/first-workflow) for an end-to-end walkthrough.
