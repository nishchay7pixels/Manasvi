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

Manasvi ships with **30 built-in tools** across 10 categories.

### Filesystem

| Tool ID | Name | Risk | Approval | What it does |
|---|---|---|---|---|
| `tool.local-file-read` | Local File Read | Low | Not required | Reads a file in the sandbox |
| `tool.fs-write-file` | FS Write File | Medium | Must require | Creates or overwrites a file in the workspace write zone |
| `tool.fs-append-file` | FS Append File | Medium | Must require | Appends content to a file in the workspace write zone |
| `tool.fs-apply-patch` | FS Apply Patch | High | Must require | Applies a unified-diff patch to a workspace file |
| `tool.fs-rename-file` | FS Rename File | Medium | Must require | Renames or moves a file within the workspace |

### Web

| Tool ID | Name | Risk | Approval | What it does |
|---|---|---|---|---|
| `tool.http-fetch` | HTTP Fetch | Medium | May require | Fetches a remote URL under egress policy |
| `tool.web-search` | Web Search | Medium | May require | Web search with structured results |
| `tool.x-search` | X Search | Medium | May require | Searches X (Twitter) via the X API adapter |

### Memory

| Tool ID | Name | Risk | Approval | What it does |
|---|---|---|---|---|
| `tool.memory-note-write` | Note Write | Medium | May require | Writes a note to a memory namespace |
| `tool.memory-search` | Memory Search | Low | Not required | Searches a memory namespace for matching notes |
| `tool.memory-get` | Memory Get | Low | Not required | Retrieves a specific memory record by ID |

### Runtime / Execution

| Tool ID | Name | Risk | Approval | What it does |
|---|---|---|---|---|
| `tool.exec` | Exec | High | Must require | Governed command execution in a sandbox |
| `tool.process` | Process | High | Must require | Inspect or signal sandbox processes |
| `tool.code-execution` | Code Execution | High | Must require | Runs code text in a managed language runtime |
| `tool.bash` | Bash | High | Must require | Runs a bash script through the governed runtime |
| `tool.shell-command` | Shell Command | High | Must require | Bounded shell execution with explicit allowlist |

### Sessions / Subagents

| Tool ID | Name | Risk | Approval | What it does |
|---|---|---|---|---|
| `tool.sessions-list` | Sessions List | Low | Not required | Lists sessions visible to the caller |
| `tool.sessions-history` | Sessions History | Low | Not required | Reads message history of a session |
| `tool.session-status` | Session Status | Low | Not required | Returns status and metadata for a session |
| `tool.sessions-send` | Sessions Send | Medium | May require | Sends a message into an active session |
| `tool.sessions-yield` | Sessions Yield | Medium | May require | Yields a result payload to a parent session |
| `tool.sessions-spawn` | Sessions Spawn | High | Must require | Creates a new session or sub-session |
| `tool.subagents` | Subagents | High | Must require | Spawns and manages subordinate agents |

### UI

| Tool ID | Name | Risk | Approval | What it does |
|---|---|---|---|---|
| `tool.canvas` | Canvas | Medium | May require | Renders structured content to the dashboard canvas |
| `tool.browser` | Browser | High | Must require | Controls a headless browser session |

### Automation

| Tool ID | Name | Risk | Approval | What it does |
|---|---|---|---|---|
| `tool.cron` | Cron | High | Must require | Manages scheduled cron jobs |
| `tool.gateway` | Gateway | High | Must require | Invokes operator-registered gateway endpoints |

### Messaging

| Tool ID | Name | Risk | Approval | What it does |
|---|---|---|---|---|
| `tool.message` | Message | Medium | May require | Sends to an operator-registered channel |

### Nodes

| Tool ID | Name | Risk | Approval | What it does |
|---|---|---|---|---|
| `tool.nodes` | Nodes | Low | Not required | Inspects the distributed node manager |

### Workflow

| Tool ID | Name | Risk | Approval | What it does |
|---|---|---|---|---|
| `tool.approval-request` | Approval Request | High | Must require | Routes an action to a human reviewer |
| `tool.agents-list` | Agents List | Low | Not required | Lists available agent definitions |

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

Tool output is always classified. Manasvi never auto-promotes trust.

| Category | Tools | Output trust class |
|---|---|---|
| Filesystem | `local-file-read`, `fs-write-file`, `fs-append-file`, `fs-apply-patch`, `fs-rename-file` | `EXTERNAL_UNTRUSTED` |
| Web | `http-fetch`, `web-search`, `x-search` | `EXTERNAL_UNTRUSTED` |
| Runtime | `exec`, `bash`, `code-execution`, `process`, `shell-command` | `EXTERNAL_UNTRUSTED` |
| Memory write | `memory-note-write` | Preserves the trust class supplied by the caller |
| Memory read | `memory-search`, `memory-get` | Per-record, as written (never silently promoted) |
| Sessions | `sessions-list`, `sessions-history`, `session-status` | `EXTERNAL_UNTRUSTED` |
| UI | `browser` | `EXTERNAL_UNTRUSTED` |
| Web/social | `x-search` | `EXTERNAL_UNTRUSTED` |
| Workflow | `approval-request` | `CONTROL_TRUSTED` (artifact) |
| Messaging | `message` | n/a (send-only) |

**Manasvi does not auto-promote tool output trust.** An agent cannot use untrusted content to make control-plane decisions without explicit operator promotion.

---

## Sandbox modes by tool

| Tool | Sandbox mode | Network | Filesystem |
|---|---|---|---|
| `tool.local-file-read` | `read_only_local` | blocked | read-only inputs |
| `tool.fs-write-file` | `no_network_compute` | blocked | scratch write |
| `tool.fs-append-file` | `no_network_compute` | blocked | scratch write |
| `tool.fs-apply-patch` | `no_network_compute` | blocked | scratch write |
| `tool.fs-rename-file` | `no_network_compute` | blocked | scratch write |
| `tool.http-fetch` | `restricted_remote` | allowlist only | none |
| `tool.web-search` | `restricted_remote` | allowlist only | none |
| `tool.x-search` | `restricted_remote` | allowlist only | none |
| `tool.memory-note-write` | `read_only_local` | blocked | scratch write |
| `tool.memory-search` | `read_only_local` | blocked | none |
| `tool.memory-get` | `read_only_local` | blocked | none |
| `tool.approval-request` | `read_only_local` | blocked | none |
| `tool.shell-command` | `no_network_compute` | blocked | scratch write |
| `tool.exec` | `no_network_compute` | blocked | scratch write |
| `tool.bash` | `no_network_compute` | blocked | scratch write |
| `tool.code-execution` | `no_network_compute` | blocked | scratch write |
| `tool.process` | `no_network_compute` | blocked | none |
| `tool.sessions-*` | `restricted_remote` | none | none |
| `tool.subagents` | `restricted_remote` | none | none |
| `tool.agents-list` | `restricted_remote` | none | none |
| `tool.nodes` | `restricted_remote` | none | none |
| `tool.canvas` | `restricted_remote` | none | none |
| `tool.browser` | `privileged_operator_approved` | allowlist only | none |
| `tool.cron` | `restricted_remote` | none | none |
| `tool.gateway` | `privileged_operator_approved` | allowlist only | none |
| `tool.message` | `restricted_remote` | allowlist only | none |

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

### Core tools (B4)
- [Local File Read](./local-file-read.md)
- [HTTP Fetch](./http-fetch.md)
- [Web Search](./web-search.md)
- [Note Write](./note-write.md)
- [Approval Request](./approval-request.md)

### New tools (B5)
- [Runtime Tools — exec, process, code-execution, bash](./runtime-tools.md)
- [Filesystem Write Tools — fs-write-file, fs-append-file, fs-apply-patch, fs-rename-file](./filesystem-write-tools.md)
- [Session Tools — sessions-list/history/send/spawn/yield, subagents, session-status](./session-tools.md)
- [Memory Tools — memory-search, memory-get](./memory-tools.md)
- [X Search](./x-search.md)
- [UI Tools — browser, canvas](./ui-tools.md)
- [Automation Tools — cron, gateway](./automation-tools.md)
- [Message, Nodes, and Agents List](./message-nodes-agents.md)

### Reference
- [Tool Invocation Reference](./tool-invocation-reference.md) — all 30 tools with prompts and expected outputs
- [Default Tool Sets](./default-sets.md)
- [Demo Flows](./demo-flows.md)
- [Troubleshooting](./troubleshooting.md)
