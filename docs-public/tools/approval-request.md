# Approval Request Tool

**Tool ID:** `tool.approval-request`
**Risk level:** High (governance artifact — not operationally risky, but classification-sensitive)
**Approval required:** Must require (by design)
**Side effects:** Creates a cryptographically-bound approval request artifact

---

## What it does

The Approval Request tool creates a human-in-the-loop approval request bound to a specific execution intent.

When Manasvi determines that an action requires human authorisation before proceeding — either because policy requires it, or the agent explicitly requests it — the approval request tool is invoked. It routes the request to a human reviewer through the approval service.

Execution of the pending intent is paused until the reviewer approves or rejects it.

This tool is one of Manasvi's most important product primitives. It is what makes the governance model visible and interactive, not just theoretical.

---

## The approval model

Approval in Manasvi is not a database flag. It is a cryptographically signed artifact.

**How it works:**

1. The orchestrator creates an **ExecutionIntent** — a signed document describing exactly what will happen
2. The approval request tool creates an **ApprovalRequest** bound to that intent's payload hash
3. A human reviewer sees the intent summary and decides: **approve** or **reject**
4. If approved, an **ApprovedIntentArtifact** is issued — signed with HMAC-SHA256, bound to the intent ID and payload hash
5. The artifact is verified by the execution manager before proceeding. It checks:
   - Signature validity
   - Intent ID matches
   - Payload hash matches (prevents bait-and-switch)
   - Artifact is not expired
   - Nonce has not been consumed (prevents replay)

This means:
- Approvals cannot be replayed
- Approvals cannot be transferred to a different intent
- Approvals expire automatically
- Every approval is audited

---

## Approval lifecycle

```
intent created
     │
     ▼
approval request created (pending)
     │
     ├──► reviewer approves ──► ApprovedIntentArtifact issued ──► execution proceeds
     │
     └──► reviewer rejects ──► intent rejected ──► execution blocked
                                                   (operator informed)

Alternatively:
     └──► TTL expires ──► artifact expired ──► execution blocked
```

---

## Risk profile

This tool is classified as **approval-sensitive** because it interacts directly with the governance mechanism.

- Its own invocation requires approval (to prevent recursive approval circumvention)
- The approval request is a security artifact: it is cryptographically bound to the specific intent
- Approval state is visible in the admin dashboard and audit trail

---

## When approval is needed

Approval for this tool's own invocation is **always required** by policy convention (`approvalHint: "must_require"`). This is intentional: the approval request tool should itself be governed.

In practice, the orchestrator creates approval requests as part of the normal tool invocation flow when policy returns `REQUIRE_APPROVAL`. The approval request tool is the mechanism through which this is surfaced to the human.

---

## Input

| Field | Required | Description |
|---|---|---|
| `intentId` | Yes | The execution intent ID that requires approval |
| `summary` | Yes | Human-readable summary of what will happen if approved (shown verbatim to the reviewer) |
| `reason` | No | Additional context explaining why approval is required |
| `urgency` | No | Reviewer queue hint: `low`, `normal` (default), or `high` |

**Write good summaries.** The `summary` field is shown directly to the human reviewer. It should clearly explain:
- What action will be taken
- What resource or target is involved
- Why it is being requested

Bad: `"Execute tool"`
Good: `"Read file /var/config/database.yml and return its contents to the user"`

---

## Output

| Field | Description |
|---|---|
| `intentId` | The intent ID the approval request is bound to |
| `approvalRequestCreated` | `true` if the request was successfully created |
| `approvalRequestId` | Unique identifier of the approval request |
| `state` | `pending`, `approved`, `rejected`, or `expired` |
| `createdAt` | ISO-8601 timestamp |

---

## Checking approval state

After an approval request is created, its state can be checked:

```bash
# Via the orchestrator
curl "http://localhost:4010/orchestration/execution-intents?intentId=<intent-id>" \
  -H "authorization: Bearer <token>"

# Via the approval service
curl "http://localhost:4015/approvals/requests/<approvalRequestId>" \
  -H "authorization: Bearer <token>"
```

Approval state is also visible in the **admin dashboard** under the Approvals tab.

---

## Submitting an approval decision

```bash
curl -X POST http://localhost:4010/orchestration/execution-intents/approval-decision \
  -H "authorization: Bearer <token>" \
  -H "content-type: application/json" \
  -d '{
    "intentId": "<intent-id>",
    "approvalRequestId": "<approval-request-id>",
    "decision": "approved",
    "reason": "Reviewed and looks safe"
  }'
```

Decision options:
- `"approved"` — issues an `ApprovedIntentArtifact` and allows execution to proceed
- `"rejected"` — blocks execution permanently for this intent

---

## What operators need to configure

**Approval service URL** — must be set in the orchestrator config:

```env
APPROVAL_SERVICE_BASE_URL=http://localhost:4015
```

**Policy rule** — the `approve` action class must be allowed for the requesting principal:

```json
{
  "effect": "allow",
  "actionClasses": ["approve"],
  "resourceClasses": ["approval-authority"]
}
```

**Approval TTL** — set `executionIntentTtlSeconds` in the orchestrator config to control how long an intent remains valid before it expires.

---

## Example usage

**User asks:** "Run `rm -rf /tmp/old-data`"

**Visible flow:**

1. Orchestrator evaluates `tool.shell-command` — policy returns `REQUIRE_APPROVAL`
2. Approval request tool invoked: `{ intentId: "...", summary: "Execute shell command: rm -rf /tmp/old-data" }`
3. Approval request created with state `pending`; response 202 returned to user
4. Operator sees pending approval in the admin dashboard
5. Operator reviews: approves or rejects
6. If approved: `ApprovedIntentArtifact` issued; execution manager proceeds
7. If rejected: intent state set to `rejected`; user informed that the action was not approved

See [Demo Flows](./demo-flows.md#demo-flow-d--approval-request) for a full walkthrough.

---

## If this tool is denied

| Reason | What to check |
|---|---|
| `TOOL_NOT_ENABLED` | Tool disabled |
| `POLICY_DENIED` | No allow rule for `approve` on `approval-authority` |
| Approval service unreachable | Check `APPROVAL_SERVICE_BASE_URL` in orchestrator config |
| Intent not found | The `intentId` must correspond to an active intent in the orchestrator |

See [Troubleshooting](./troubleshooting.md) for more.

---

## See also

- [Built-in Tools Overview](./overview.md)
- [Default Tool Sets](./default-sets.md)
- [Demo Flows](./demo-flows.md)
- [Troubleshooting](./troubleshooting.md)
