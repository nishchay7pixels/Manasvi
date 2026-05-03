# Message, Nodes, and Agents List Tools

---

## message — `tool.message`

Sends a message to an operator-configured channel (Telegram, Slack, webhook, etc.).

**Action class:** `send-message` | **Side effects:** `external_side_effect` | **Approval:** may require

### Input

| Field | Type | Description |
|---|---|---|
| `channel` | string | Operator-registered channel ID |
| `content` | string | Message content |
| `format` | enum | `text`, `markdown`, or `json` |
| `recipient` | string | Optional recipient within the channel |
| `threadId` | string | Optional thread to reply into |

### Safety notes
- Only operator-registered channels are reachable
- All messages are logged in the audit trail
- Sensitive content must not be sent without explicit operator policy

### Default Set

Included in `manasvi.toolset.controlled-write`.

---

## nodes — `tool.nodes`

Inspects the distributed node manager and remote execution surfaces.

**Action class:** `inspect-node` | **Read-only** | **Approval:** none (for read operations)

### Operations

| Operation | Description |
|---|---|
| `list` | List all available nodes with status |
| `inspect` | Detailed info for a specific node |
| `capabilities` | List capabilities of a node |
| `dispatch` | Dispatch a tool invocation to a specific node (approval required) |

### Safety notes
- List/inspect/capabilities are read-only and safe
- `dispatch` is approval-sensitive and requires additional policy
- Node capabilities define what tools can run on that node

### Default Set

Included in `manasvi.toolset.starter-read`.

---

## agents-list — `tool.agents-list`

Lists available agent definitions visible to the calling principal.

**Action class:** `list-agents` | **Read-only** | **Approval:** none

Returns agent metadata: capabilities, tool IDs, version, status, and owner. Used for agent discovery before spawning subagents or routing tasks.

### Output

```json
{
  "agents": [{
    "agentDefinitionId": "agent-def:summariser",
    "name": "Summariser",
    "capabilities": ["web.search", "memory.write"],
    "toolIds": ["tool.web-search", "tool.memory-note-write"],
    "status": "active"
  }],
  "total": 1
}
```

### Default Set

Included in `manasvi.toolset.starter-read`.

---

## See also

- [Built-in Tools Overview](./overview.md)
- [Default Tool Sets](./default-sets.md)
- [Demo Flows](./demo-flows.md)
- [Troubleshooting](./troubleshooting.md)
