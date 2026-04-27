# Note Write Tool

**Tool ID:** `tool.memory-note-write`
**Risk level:** Medium
**Approval required:** May require (operator-configurable)
**Side effects:** Mutating — writes a record to the memory namespace

---

## What it does

The Note Write tool persists a note or memory entry into a policy-governed memory namespace.

Manasvi may use this tool when:

- An agent discovers a useful fact and wants to remember it across sessions
- A user explicitly asks the agent to "remember" something
- An agent is summarising a session and wants to save key points
- An agent stores references or instructions for later retrieval

Notes are stored with an explicit **trust classification** and **provenance chain**. They are never silently promoted to a higher trust level.

---

## Risk profile

This is a **mutating** tool with medium risk.

- **Trust is preserved**: notes retain the trust classification provided by the caller; `MODEL_GENERATED_UNTRUSTED` stays untrusted
- **Namespace isolation**: writes are scoped to the tenant/workspace namespace; cross-tenant contamination is blocked at the policy and memory service level
- **No network access**: the sandbox operates in `read_only_local` mode during this tool's execution
- **CONTROL_TRUSTED writes require explicit policy**: elevating trust in memory is a privileged operation

---

## When approval is needed

Approval **may be required** depending on the target namespace and trust class. Policy binding uses `approvalHint: "may_require"`.

Operators can configure policy to:
- Require approval for `CONTROL_TRUSTED` writes
- Allow `MODEL_GENERATED_UNTRUSTED` writes without approval
- Block writes to certain namespaces entirely

---

## Input

| Field | Required | Description |
|---|---|---|
| `namespace` | Yes | Target memory namespace. Must be within the caller's tenant/workspace scope |
| `note` | Yes | Note content as a UTF-8 string |
| `trustClassification` | Yes | One of: `USER_OWNED`, `EXTERNAL_UNTRUSTED`, `CONTROL_TRUSTED`, `MODEL_GENERATED_UNTRUSTED` |
| `noteType` | No | `fact`, `summary`, `instruction`, `reference`, or `session-note` (default `fact`) |
| `metadata` | No | Arbitrary key/value metadata |
| `tags` | No | String tags for filtering and retrieval |

**Trust classification guidance:**

| Classification | When to use |
|---|---|
| `USER_OWNED` | Content the user explicitly provided or approved |
| `MODEL_GENERATED_UNTRUSTED` | AI-generated content that has not been verified |
| `EXTERNAL_UNTRUSTED` | Content from the web, files, or external APIs |
| `CONTROL_TRUSTED` | Operator-approved content (requires explicit policy) |

---

## Output

| Field | Description |
|---|---|
| `namespace` | The namespace the note was written into |
| `noteId` | Unique identifier of the created note |
| `noteType` | The note type as persisted |
| `persisted` | `true` if the write succeeded |
| `trustClassification` | Trust class assigned to the note |
| `createdAt` | ISO-8601 timestamp |
| `provenance` | Source and namespace metadata |

---

## What operators need to configure

**Memory namespace policy** — the `mutate-memory` action class must be allowed for the relevant principal types.

```json
{
  "effect": "allow",
  "actionClasses": ["mutate-memory"],
  "resourceClasses": ["memory-namespace"],
  "conditions": {
    "trustClassification": ["USER_OWNED", "MODEL_GENERATED_UNTRUSTED", "EXTERNAL_UNTRUSTED"]
  }
}
```

For `CONTROL_TRUSTED` writes, add a separate more restrictive rule.

**Memory service URL** — the memory service must be running and reachable by the execution environment.

---

## How to enable or disable

```bash
# Disable
curl -X POST http://localhost:4010/tools/status \
  -H "authorization: Bearer <token>" \
  -H "content-type: application/json" \
  -d '{"toolId": "tool.memory-note-write", "version": "1.0.0", "status": "disabled"}'
```

---

## Example usage

**User asks:** "Remember that the project deadline is March 15th."

**Visible flow:**

1. Orchestrator resolves `tool.memory-note-write` — `enabled`
2. Input: `{ namespace: "tenant/workspace/notes/user-123", note: "Project deadline is March 15th", noteType: "fact", trustClassification: "USER_OWNED" }`
3. Policy evaluates `mutate-memory` — `ALLOW`
4. Intent created; system artifact issued
5. Execution manager runs in sandbox; `tool:memory-write` handler called
6. Note created: `{ noteId: "note:1k3x", persisted: true, trustClassification: "USER_OWNED" }`
7. Agent confirms to the user: "I've remembered that."

See [Demo Flows](./demo-flows.md#demo-flow-c--note-write) for a full walkthrough.

---

## If this tool is denied

| Reason | What to check |
|---|---|
| `TOOL_NOT_ENABLED` | Tool disabled |
| `POLICY_DENIED` | No allow rule for `mutate-memory` for this principal or trust class |
| Namespace rejected | Target namespace is outside the principal's allowed scope |
| `REQUIRE_APPROVAL` | Policy requires approval for writes to this namespace or trust class |

See [Troubleshooting](./troubleshooting.md) for more.
