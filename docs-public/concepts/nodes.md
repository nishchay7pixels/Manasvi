---
sidebar_position: 5
title: Nodes
description: What remote execution nodes are and how they work
---

# Nodes

## What is a node?

A node is a **remote execution environment** — a separate machine or environment where Manasvi can dispatch workloads to run.

The core Manasvi system (orchestrator, policy service, etc.) runs in your main environment. Nodes are additional compute resources that can:

- Execute tool actions in a different environment
- Run code on a machine with specific hardware (GPU, more RAM, etc.)
- Process sensitive workloads in an isolated environment
- Scale execution across multiple machines

## Why separate execution nodes?

Some workloads shouldn't run on the same machine as the control plane. Examples:

- **Privacy-sensitive computation** — run on a machine that isn't exposed to the internet
- **Specialized hardware** — run GPU-intensive model inference on a machine with a GPU
- **Resource isolation** — prevent a heavy workload from affecting the orchestrator's responsiveness
- **Organizational separation** — a department's data never leaves their own infrastructure

## How nodes work

1. **Pairing**: A node registers with the node manager by providing its capabilities and identity
2. **Heartbeat**: Nodes send regular heartbeats to confirm they're alive and healthy
3. **Dispatch**: When the orchestrator decides to run something on a node, the node manager sends a **signed dispatch request** to the node agent
4. **Verification**: The node agent verifies the dispatch is legitimate before accepting work
5. **Execution**: The node agent runs the workload in its own sandboxed environment
6. **Result**: The result is returned through the dispatch channel and recorded in the audit trail

## Node security model

Nodes cannot be exploited by replay attacks:

- Every dispatch contains a **unique nonce** (a one-time random value)
- Every dispatch contains a **payload hash** that binds together the intent, artifact, node, and expiry time
- A node will reject any dispatch with a previously-seen nonce
- A node will reject any dispatch whose payload hash doesn't match its contents

This means an attacker who intercepts a dispatch cannot reuse it on a different node or with modified parameters.

## Node classes

Nodes are classified by their trust level:

| Class | Trust level | Typical use |
|-------|------------|-------------|
| `local_node` | Highest | Same operator, same network |
| `trusted_personal_node` | High | Personal machine, known owner |
| `restricted_utility_node` | Medium | Shared resource, limited capabilities |
| `high_risk_isolated_node` | Low | Untrusted environment, maximum isolation |

The node's trust class affects what workloads it can receive and what capabilities are granted.

## Related concepts

- [Security: Replay and Tampering Resistance](/docs/security/replay-tampering) — dispatch security model
- [Architecture: Node Manager](/docs/architecture/node-manager) — the node management service
