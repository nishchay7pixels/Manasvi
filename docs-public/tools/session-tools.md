# Session and Subagent Tools

Seven tools for reading, mutating, and creating sessions within the Manasvi session plane.

---

## sessions-list — `tool.sessions-list`

Lists sessions visible to the calling principal.

**Action class:** `read-session` | **Read-only** | **Approval:** none

Returns session metadata only — no message content.

---

## sessions-history — `tool.sessions-history`

Reads the message history of a session.

**Action class:** `read-session` | **Read-only** | **Approval:** none

Trust classification of each message is preserved in results. Caller must own or have explicit read access to the session.

---

## session-status — `tool.session-status`

Returns current status, risk profile, and metadata for a specific session.

**Action class:** `read-session` | **Read-only** | **Approval:** none

---

## sessions-send — `tool.sessions-send`

Sends a message into an active session, continuing the conversation.

**Action class:** `mutate-session` | **Side effects:** `mutating` | **Approval:** may require

### Safety notes
- `role=system` messages carry higher implicit weight — use deliberately
- Cross-session injection requires explicit policy

---

## sessions-spawn — `tool.sessions-spawn`

Creates a new session or sub-session under the current principal's authority.

**Action class:** `mutate-session` | **Side effects:** `mutating` | **Approval:** required

Sub-sessions inherit the parent's tenant/workspace policy constraints.

---

## sessions-yield — `tool.sessions-yield`

Yields a result payload from the current session to a parent or peer session.

**Action class:** `mutate-session` | **Side effects:** `mutating` | **Approval:** may require

Used to hand off control or return a result from a sub-session workflow.

---

## subagents — `tool.subagents`

Creates, lists, inspects, or terminates subordinate agents.

**Action class:** `spawn-subagent` | **Side effects:** `mutating` | **Approval:** required

Subagents cannot escalate beyond the parent's policy constraints.

---

## Default Sets

| Set | Includes |
|---|---|
| `manasvi.toolset.starter-read` | `sessions-list`, `sessions-history`, `session-status` |
| `manasvi.toolset.controlled-write` | `sessions-send`, `sessions-yield` |
| `manasvi.toolset.workflow-operator` | `sessions-spawn`, `subagents` |

---

## Policy Requirements

Read tools require `action: read` on `resourceClass: session`.

Write/spawn tools require `action: write` or `action: execute` on `resourceClass: session` or `agent-definition`.

---

## See also

- [Built-in Tools Overview](./overview.md)
- [Default Tool Sets](./default-sets.md)
- [Demo Flows](./demo-flows.md)
- [Troubleshooting](./troubleshooting.md)
