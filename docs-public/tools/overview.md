# Built-in Tools Overview

Manasvi ships with a curated set of built-in tools that give it immediate, practical utility.

Every tool is:

- **Registered** — declared in a typed manifest before it can be used
- **Policy-governed** — policy decides whether a principal can invoke it
- **Execution-mediated** — runs through the execution manager with intent signing and artifact verification
- **Sandboxed** — runs inside an isolated child process with enforced network, filesystem, and memory limits
- **Auditable** — every invocation produces an execution result artifact with trace metadata

This is not a plugin registry with raw capabilities. It is a governed toolset where every action passes through policy, intent creation, and sandboxed execution.

---

## Built-in tools at a glance

| Tool ID | Name | Risk | Approval | What it does |
|---|---|---|---|---|
| `tool.local-file-read` | Local File Read | Low | Not required | Reads a local file in the sandbox |
| `tool.http-fetch` | HTTP Fetch | Medium | May require | Fetches a remote URL under egress policy |
| `tool.web-search` | Web Search | Medium | May require | Web search with structured results |
| `tool.memory-note-write` | Note Write | Medium | May require | Writes a note to a memory namespace |
| `tool.approval-request` | Approval Request | High | Must require | Routes an action to a human reviewer |
| `tool.shell-command` | Shell Command | High | Must require | Bounded shell execution (not in default set) |

---

## What "governed" means for tools

When Manasvi considers using a tool, the following happens:

1. **Tool lookup** — the tool ID is resolved in the in-memory registry
2. **Status check** — if the tool is disabled or deprecated, the invocation fails immediately with `TOOL_NOT_ENABLED`
3. **Input validation** — input is parsed against the tool's typed Zod schema; invalid input returns `TOOL_INPUT_VALIDATION_FAILED`
4. **Policy evaluation** — the policy service evaluates whether the principal can perform the tool's action class on its resource class; `DENY` returns `POLICY_DENIED`
5. **Intent creation** — an execution intent is created and signed, binding the action to the principal context
6. **Approval check** — if policy returns `REQUIRE_APPROVAL`, an approval request is created and execution pauses
7. **Artifact issuance** — if no approval is needed, a system approval artifact is issued
8. **Contract creation** — a tool execution contract bundles the invocation, manifest, intent, and artifact
9. **Sandboxed execution** — the execution manager verifies the contract, derives the runtime policy, and runs the tool in an isolated child process
10. **Output validation** — output is parsed against the tool's typed output schema
11. **Result returned** — the result includes provenance metadata and the execution artifact ID

Every step is logged and traceable. No step can be bypassed.

---

## Trust classification on tool output

Tool output is always externally-sourced and is classified appropriately:

| Tool | Output trust class |
|---|---|
| `tool.local-file-read` | `EXTERNAL_UNTRUSTED` |
| `tool.http-fetch` | `EXTERNAL_UNTRUSTED` |
| `tool.web-search` | `EXTERNAL_UNTRUSTED` |
| `tool.memory-note-write` | Preserves the trust class of the written content |
| `tool.approval-request` | `CONTROL_TRUSTED` (workflow artifact) |
| `tool.shell-command` | `EXTERNAL_UNTRUSTED` |

**Manasvi does not auto-promote tool output trust.** An agent cannot use untrusted file content or web results to make control-plane decisions without explicit operator promotion.

---

## Sandbox modes by tool

| Tool | Sandbox mode | Network | Filesystem |
|---|---|---|---|
| `tool.local-file-read` | `read_only_local` | blocked | read-only inputs |
| `tool.http-fetch` | `restricted_remote` | allowlist only | none |
| `tool.web-search` | `restricted_remote` | allowlist only | none |
| `tool.memory-note-write` | `read_only_local` | blocked | scratch write |
| `tool.approval-request` | `read_only_local` | blocked | none |
| `tool.shell-command` | `no_network_compute` | blocked | scratch write |

---

## Default tool sets

Rather than enabling tools one by one, Manasvi provides **default tool sets** — curated, named groups with a defined risk posture.

See [Default Tool Sets](./default-sets.md) for details.

---

## Enabling and disabling tools

Tools are registered in the orchestrator's in-memory registry at startup.
Status can be changed at runtime via the orchestrator API.

```bash
# Disable a tool
curl -X POST http://localhost:4010/tools/status \
  -H "content-type: application/json" \
  -H "authorization: Bearer <token>" \
  -d '{"toolId": "tool.shell-command", "version": "1.0.0", "status": "disabled"}'

# List all tools
curl http://localhost:4010/admin/tools
```

Or use the CLI:

```bash
pnpm manasvi tools list
pnpm manasvi tools inspect tool.web-search
pnpm manasvi tools sets
```

---

## Policy configuration for tools

Tools require matching policy rules. The default policy set at `configs/policies/default-policy-set.json` includes rules for the built-in tools.

Each tool declares its `policyActionClass` and `policyResourceClass`. Policy rules must explicitly allow the relevant `actionClass` for the requesting principal.

If a policy rule is missing, the tool invocation returns `POLICY_DENIED` with reason codes.

---

## Tool reference docs

- [Local File Read](./local-file-read.md)
- [HTTP Fetch](./http-fetch.md)
- [Web Search](./web-search.md)
- [Note Write](./note-write.md)
- [Approval Request](./approval-request.md)
- [Default Tool Sets](./default-sets.md)
- [Demo Flows](./demo-flows.md)
- [Troubleshooting](./troubleshooting.md)
