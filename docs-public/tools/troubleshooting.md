# Tool Troubleshooting

This guide covers the most common reasons a tool invocation fails and how to fix each one.

---

## Error codes at a glance

| Code | What it means | Where to look |
|---|---|---|
| `TOOL_NOT_REGISTERED` | Tool ID not found in registry | Restart orchestrator; check `preloadBuiltIns` |
| `TOOL_NOT_ENABLED` | Tool is disabled or deprecated | Enable via `/tools/status` API |
| `TOOL_INPUT_VALIDATION_FAILED` | Input does not match the tool's schema | Check input fields and types |
| `TOOL_OUTPUT_VALIDATION_FAILED` | Tool returned unexpected output | Check sandbox runtime, possible schema mismatch |
| `POLICY_DENIED` | Policy blocked the invocation | Check policy rules in `configs/policies/` |
| `PENDING_APPROVAL` | Human approval required | Submit decision via approval API |
| `NETWORK_EGRESS_BLOCKED` | Target host not in egress allowlist | Add allowlist entry |
| `FS_READ_BLOCKED` | File path outside allowed read paths | Check filesystem policy |
| `FS_WRITE_BLOCKED` | Write outside allowed write paths | Check filesystem policy |
| `COMMAND_NOT_ALLOWED` | Shell command not in allowedCommands | Add to the allowed list |
| `EXECUTION_TIMEOUT` | Tool took longer than allowed | Increase `timeoutMs` or optimize the operation |
| `QUOTA_EXCEEDED` | CPU or memory limit hit | Check sandbox resource limits |
| `EXECUTION_TOKEN_INVALID` | Token expired or wrong key | Check `internalAuthVerificationKeys` config |
| `CALLER_CONTEXT_MISMATCH` | Caller in contract doesn't match request | Check principal resolution |
| `TOOL_RUNTIME_BINDING_MISMATCH` | Intent binding doesn't match manifest | Restart orchestrator to reload manifests |

---

## TOOL_NOT_ENABLED

**Symptom:** Response is `409` with `errorCode: "TOOL_NOT_ENABLED"`

**Cause:** The tool is registered but has status `disabled` or `deprecated`.

**Fix:**

```bash
curl -X POST http://localhost:4010/tools/status \
  -H "authorization: Bearer <token>" \
  -H "content-type: application/json" \
  -d '{"toolId": "tool.web-search", "version": "1.0.0", "status": "enabled"}'
```

Or check its current status:

```bash
pnpm manasvi tools inspect tool.web-search
# or
curl http://localhost:4010/admin/tools | jq '.tools[] | select(.toolId == "tool.web-search")'
```

---

## POLICY_DENIED

**Symptom:** Response is `403` with `status: "policy_denied"` in the tool result

**Cause:** The policy service evaluated the tool's action class against the principal and returned `DENY`.

**Fix:**

1. Check what action class and resource class the tool requires:
   ```bash
   pnpm manasvi tools inspect <tool-id>
   # Look at "Policy binding" section
   ```

2. Open `configs/policies/default-policy-set.json`

3. Find or add a rule that allows the relevant action class for the principal type:
   ```json
   {
     "ruleId": "allow-web-search-for-agents",
     "effect": "allow",
     "actionClasses": ["access-network"],
     "resourceClasses": ["network-zone"],
     "conditions": {}
   }
   ```

4. Restart the policy service to pick up changes.

5. Re-check with `pnpm manasvi doctor`.

---

## NETWORK_EGRESS_BLOCKED

**Symptom:** Tool execution fails with `NETWORK_EGRESS_BLOCKED` in the result artifact

**Cause:** The destination host/port is not in the execution manager's egress allowlist.

**Fix:**

Add the host to the egress allowlist in the execution manager config:

```json
{
  "egressWhitelistPolicy": [
    { "hostPattern": "api.example.com", "port": 443, "protocol": "https" },
    { "hostPattern": "duckduckgo.com", "port": 443, "protocol": "https" }
  ]
}
```

Wildcards are supported: `"hostPattern": "*.example.com"` matches all subdomains.

To allow all egress (only in development), use `"operator_approved"` network mode (not recommended for production).

---

## TOOL_INPUT_VALIDATION_FAILED

**Symptom:** Response is `422` with `errorCode: "TOOL_INPUT_VALIDATION_FAILED"`

**Cause:** One or more input fields failed Zod schema validation.

**Fix:**

Check the error message for the specific field and constraint that failed.

Common issues:
- `path` field missing or empty for `tool.local-file-read`
- `url` field is not a valid URL for `tool.http-fetch`
- `query` field missing for `tool.web-search`
- `trustClassification` is not one of the allowed enum values for `tool.memory-note-write`

Inspect the tool's input schema:

```bash
pnpm manasvi tools inspect tool.memory-note-write
```

---

## FS_READ_BLOCKED

**Symptom:** Tool execution returns status `policy_violation` with code `FS_READ_BLOCKED`

**Cause:** The file path is outside the allowed read paths declared in the runtime policy.

**Fix:**

By default, the sandbox only allows reading from the run's input and output directories (`/tmp/manasvi-runs/<runId>/input`, etc.).

To allow reading from a custom path, the execution manager's runtime policy must declare that path in `filesystem.readPaths`.

This is controlled by the execution manager's `sandboxProfileDefault` config and the tool's `filesystemProfile` runtime hint. For `read_only_local`, the filesystem profile is `read_only_inputs`.

Custom filesystem path expansion requires operator configuration of the runtime policy derivation in `apps/execution-manager/src/runtime-policy.ts`.

---

## Approval stuck as pending

**Symptom:** Tool invocation returns `202` with `pendingApproval: true` and never proceeds

**Cause:** No operator has submitted a decision on the approval request.

**Fix:**

1. List pending approval requests:
   ```bash
   curl http://localhost:4015/approvals/requests \
     -H "authorization: Bearer <token>"
   ```

2. Submit a decision:
   ```bash
   curl -X POST http://localhost:4010/orchestration/execution-intents/approval-decision \
     -H "authorization: Bearer <token>" \
     -H "content-type: application/json" \
     -d '{
       "intentId": "<intent-id>",
       "approvalRequestId": "<approval-request-id>",
       "decision": "approved",
       "reason": "Reviewed and approved"
     }'
   ```

3. In the admin dashboard, check the Approvals tab.

If the approval has expired (TTL exceeded), the intent cannot be executed. A new request must be initiated.

---

## Approval artifact expired

**Symptom:** `ARTIFACT_EXPIRED` during execution validation

**Cause:** The approved intent artifact's TTL passed before execution was attempted.

**Fix:**

The intent TTL is configured via `executionIntentTtlSeconds` in the orchestrator config. Increase it if approval workflows are slow.

Once expired, a new intent and approval request must be created. The action cannot be re-executed with the old artifact.

---

## EXECUTION_TOKEN_INVALID

**Symptom:** Execution result artifact has `status: "validation_failed"` with code `EXECUTION_TOKEN_INVALID`

**Cause:** The execution token issued by the execution manager could not be verified.

**Fix:**

Check that `internalAuthVerificationKeys` in the execution manager config contains the same key ID and secret used for signing. Key rotation without updating both signing and verification config is the most common cause.

---

## Tool output validation failed

**Symptom:** Response from `/execution/execute-tool-contract` is `422` with `TOOL_OUTPUT_VALIDATION_FAILED`

**Cause:** The sandbox returned output that doesn't match the tool's declared output schema. This can happen if:
- A tool handler was updated but the manifest was not
- The sandbox returned a partial result due to a runtime error
- A field type mismatch exists between the handler and the schema

**Fix:**

1. Check the raw `resultArtifact` in the response to see what was actually returned
2. Compare with the tool's output schema: `pnpm manasvi tools inspect <tool-id>`
3. Fix the sandbox handler in `packages/sandbox-runtime/src/index.ts` if needed

---

## Policy evaluates but tool still fails

**Symptom:** Policy returns `ALLOW` but the tool still fails at execution

**Cause:** Policy is evaluated twice — once at invocation (orchestrator) and once at execution (execution manager). Both must pass.

**Fix:**

Check the execution-manager policy rules. The execution manager evaluates the action class from the intent snapshot against its own policy client. Ensure the same allow rules exist in the policy service that the execution manager points to.

Run `pnpm manasvi doctor` to check service connectivity and config consistency.

---

## Getting more detail

```bash
# Orchestrator tool registry
curl http://localhost:4010/admin/tools

# Execution integrity audit (shows all artifact consumption events)
curl http://localhost:4011/execution/audit/integrity

# Approval audit buffer
curl http://localhost:4015/approvals/audit \
  -H "authorization: Bearer <token>"

# CLI diagnosis
pnpm manasvi doctor
```
