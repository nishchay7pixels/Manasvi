# Web Search Tool

**Tool ID:** `tool.web-search`
**Risk level:** Medium
**Approval required:** May require (operator-configurable)
**Side effects:** External — outbound search query to a search engine adapter

---

## What it does

The Web Search tool performs a governed web search and returns structured results with provenance metadata.

Manasvi may use this tool when a user asks it to:

- Look something up on the web
- Find recent information about a topic
- Research a question that requires current public knowledge

Search results are returned as a structured list of `{ title, url, snippet }` objects. All results are clearly marked `EXTERNAL_UNTRUSTED`.

The current default adapter uses the DuckDuckGo Instant Answer API. This can be swapped for a different adapter by the operator.

---

## Risk profile

This is a **network-touching** tool with medium risk.

- **No private data sent to the search engine**: queries are submitted as plain text
- **Results are `EXTERNAL_UNTRUSTED`**: search snippets are not automatically acted upon as facts
- **Egress-controlled**: the search endpoint must be in the egress allowlist
- **Safe mode enabled by default**: explicit content filtering is on unless disabled

---

## When approval is needed

By default, approval **may be required** based on the principal type and context. The policy binding uses `approvalHint: "may_require"`.

Operators can configure policy to:
- Require approval for all search queries
- Allow search for known-safe agent types without approval
- Deny search access entirely for untrusted actors

---

## Input

| Field | Required | Description |
|---|---|---|
| `query` | Yes | Natural language search query |
| `maxResults` | No | Maximum results to return, 1–10 (default 5) |
| `safeMode` | No | Enable safe search filtering (default `true`) |

---

## Output

| Field | Description |
|---|---|
| `query` | The query that was executed |
| `results` | Array of `{ title, url, snippet }` objects (EXTERNAL_UNTRUSTED) |
| `provenance` | Source `web-search`, trust class `EXTERNAL_UNTRUSTED` |

Each result item:

| Field | Description |
|---|---|
| `title` | Title of the search result |
| `url` | URL of the result |
| `snippet` | Short excerpt — up to 240 characters |

---

## What operators need to configure

**Egress allowlist** — the search engine endpoint must be reachable.

For DuckDuckGo:
```json
{ "hostPattern": "duckduckgo.com", "port": 443, "protocol": "https" }
```

The policy action class is `access-network` on resource class `network-zone:web-search`. Policy rules must allow this.

To swap search adapters, update the `tool:web-search` handler in the sandbox runtime worker.

---

## How to enable or disable

```bash
# Disable
curl -X POST http://localhost:4010/tools/status \
  -H "authorization: Bearer <token>" \
  -H "content-type: application/json" \
  -d '{"toolId": "tool.web-search", "version": "1.0.0", "status": "disabled"}'

# Check status
pnpm manasvi tools inspect tool.web-search
```

---

## Example usage

**User asks:** "What is the current capital of Germany?"

**Visible flow:**

1. Orchestrator resolves `tool.web-search` — `enabled`
2. Input validation: `{ query: "current capital of Germany", maxResults: 5 }`
3. Policy evaluates `access-network` on `network-zone` — `ALLOW`
4. Intent created; system artifact issued
5. Execution manager runs in `restricted_remote` sandbox
6. DuckDuckGo Instant Answer API queried
7. Results returned: `[{ title: "Berlin", url: "...", snippet: "Berlin is the capital..." }]`
8. Agent uses the result as external reference with provenance note

See [Demo Flows](./demo-flows.md#demo-flow-b--web-search) for a full walkthrough.

---

## If this tool is denied

| Reason | What to check |
|---|---|
| `TOOL_NOT_ENABLED` | Tool disabled |
| `POLICY_DENIED` | No allow rule for `access-network` on `network-zone:web-search` |
| `NETWORK_EGRESS_BLOCKED` | Search endpoint not in egress allowlist |
| Empty results | Search engine returned no matches; query may need rephrasing |
| `REQUIRE_APPROVAL` | Policy requires approval for this principal type |

See [Troubleshooting](./troubleshooting.md) for more.
