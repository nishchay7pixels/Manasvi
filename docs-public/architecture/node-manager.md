---
sidebar_position: 9
title: Node Manager
description: How remote execution nodes are managed and dispatched to
---

# Node Manager

## What it does

The node manager maintains the registry of available remote execution nodes and handles dispatch to them. When the execution manager needs to run a workload on a remote node, it delegates to the node manager.

## Node registry

The node registry tracks all registered nodes:

- Node ID and capabilities
- Node class (trust level)
- Current health status (based on heartbeats)
- Last seen timestamp

When selecting a node for dispatch, the node manager considers:
- Whether the node is healthy (recent heartbeat)
- Whether the node's trust class is appropriate for the workload
- Whether the node has the required capabilities

## Dispatch process

When the execution manager requests a remote dispatch:

1. **Select a node** — find a healthy node appropriate for the workload
2. **Create a dispatch request** — build the structured dispatch artifact
3. **Generate a nonce** — create a unique one-time dispatch identifier
4. **Compute a payload hash** — create a hash covering the intent, artifact, node ID, dispatch ID, and expiry
5. **Record the nonce** — mark the nonce as consumed so it cannot be reused
6. **Send the dispatch** — deliver the signed dispatch request to the node agent

## Dispatch security

Each dispatch request is signed and includes:

- **Dispatch nonce** — a unique value that the node agent will reject if it has seen before
- **Dispatch payload hash** — a hash that covers the key fields of the request; any modification will be detected

If an attacker intercepts a dispatch request, they cannot:
- **Replay it** — the nonce is consumed on first receipt
- **Modify the parameters** — the payload hash would no longer match
- **Redirect it to another node** — the node ID is covered by the hash

## Node health monitoring

Nodes send regular heartbeats to the node manager. If a node stops sending heartbeats:

- It's marked as unhealthy in the registry
- It's excluded from dispatch selection
- An alert is triggered for the operator

When a node comes back online and resumes heartbeats, it's automatically returned to healthy status.

## Node classes and trust

The node class determines what workloads a node can receive and what trust level it operates at:

| Class | Trust | Typical configuration |
|-------|-------|----------------------|
| `local_node` | Highest | Same operator, same network segment |
| `trusted_personal_node` | High | Known owner, controlled environment |
| `restricted_utility_node` | Medium | Shared resource, limited to specific tool types |
| `high_risk_isolated_node` | Low | Air-gapped or high-isolation environment |

High-risk workloads are dispatched to lower-trust nodes where containment is tighter.

## Related concepts

- [Nodes](/docs/concepts/nodes) — the node concept overview
- [Architecture: Execution Manager](/docs/architecture/execution-manager) — the dispatch trigger
- [Security: Replay and Tampering Resistance](/docs/security/replay-tampering) — dispatch security model
