# HTTP Fetch Tool

**Tool ID:** `tool.http-fetch`
**Risk level:** Medium
**Approval required:** May require (operator-configurable)
**Side effects:** External — network egress to remote URL

---

## What it does

The HTTP Fetch tool fetches the content of a remote HTTP or HTTPS URL and returns the response body as plain text.

Manasvi may use this tool when a user asks it to:

- Fetch the content of a specific web page or document URL
- Retrieve API responses (GET only)
- Read remote configuration or reference data

The fetch runs inside a `restricted_remote` sandbox. Network egress is strictly limited to the operator-configured allowlist. No filesystem writes occur. The response is returned with a content preview of up to ~800 characters.

---

## Risk profile

This is a **network-touching** tool with medium risk.

- **Egress-controlled**: only URLs matching the operator allowlist are reachable; blocked destinations fail with `NETWORK_EGRESS_BLOCKED`
- **GET only**: POST and mutation methods are not supported
- **Output is `EXTERNAL_UNTRUSTED`**: remote content must not be used to influence control-plane decisions without review
- **Body is truncated** at the sandbox output limit to prevent large data exfiltration

---

## When approval is needed

By default, approval **may be required** depending on the target domain and principal type. The policy binding uses `approvalHint: "may_require"`.

Operators can configure policy to:
- Require approval for fetches to sensitive domains
- Allow fetches to known-safe domains without approval
- Deny fetches entirely for certain principal types

---

## Input

| Field | Required | Description |
|---|---|---|
| `url` | Yes | Fully-qualified HTTPS or HTTP URL to fetch |
| `method` | No | HTTP method — only `GET` is allowed (default) |
| `headers` | No | Additional request headers. Sensitive headers (Authorization, Cookie) are filtered by policy |
| `timeoutMs` | No | Request timeout in ms, maximum 30 000 ms (default 12 000) |

---

## Output

| Field | Description |
|---|---|
| `url` | The URL that was fetched |
| `status` | HTTP response status code |
| `preview` | First ~800 characters of the response body (EXTERNAL_UNTRUSTED) |
| `contentType` | Content-Type header if present |
| `truncated` | `true` if the response body exceeded the sandbox output limit |
| `provenance` | Source `remote-http`, trust class `EXTERNAL_UNTRUSTED` |

---

## What operators need to configure

**Egress allowlist** — required for this tool to function.

Configure the egress allowlist in the execution manager config. Without it, all fetches are blocked.

```json
// In execution manager environment / config:
{
  "egressWhitelistPolicy": [
    { "hostPattern": "*.example.com", "port": 443, "protocol": "https" },
    { "hostPattern": "api.service.io", "port": 443, "protocol": "https" }
  ]
}
```

The policy action class is `access-network` on resource class `network-zone:egress`. Policy rules must allow this action.

---

## How to enable or disable

This tool ships enabled. To disable:

```bash
curl -X POST http://localhost:4010/tools/status \
  -H "authorization: Bearer <token>" \
  -H "content-type: application/json" \
  -d '{"toolId": "tool.http-fetch", "version": "1.0.0", "status": "disabled"}'
```

---

## Example usage

**User asks:** "Fetch the content of `https://example.com/report.txt` and summarise it."

**Visible flow:**

1. Orchestrator resolves `tool.http-fetch` — `enabled`
2. Input validation: `{ url: "https://example.com/report.txt" }`
3. Policy evaluates `access-network` on `network-zone` — `ALLOW`
4. Intent created; system artifact issued
5. Execution manager verifies contract; derives `restricted_remote` sandbox
6. Sandbox checks `example.com:443` against egress allowlist — allowed
7. Response returned: `{ status: 200, preview: "...", contentType: "text/plain" }`
8. Agent summarises content in its response

See [Demo Flows](./demo-flows.md#demo-flow-b--http-fetch) for a full walkthrough.

---

## If this tool is denied

| Reason | What to check |
|---|---|
| `TOOL_NOT_ENABLED` | Tool disabled — enable via `/tools/status` |
| `POLICY_DENIED` | No allow rule for `access-network` for this principal |
| `NETWORK_EGRESS_BLOCKED` | Target host not in egress allowlist |
| Timeout | Increase `timeoutMs` or check network connectivity |
| `REQUIRE_APPROVAL` | Policy requires approval for this domain/principal |

See [Troubleshooting](./troubleshooting.md) for more.

---

## See also

- [Built-in Tools Overview](./overview.md)
- [Default Tool Sets](./default-sets.md)
- [Demo Flows](./demo-flows.md)
- [Troubleshooting](./troubleshooting.md)
