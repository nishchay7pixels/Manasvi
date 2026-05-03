# Runtime Execution Tools

Manasvi provides four governed runtime execution tools: `exec`, `process`, `code-execution`, and `bash`. All share the same governance contract: every invocation goes through **policy → intent signing → approval → sandbox → audit**.

---

## exec — `tool.exec`

General-purpose command execution in a sandboxed environment.

**Action class:** `execute` | **Side effects:** `privileged` | **Approval:** required

### Input
| Field | Type | Description |
|---|---|---|
| `command` | string | Executable name or path |
| `args` | string[] | Positional arguments |
| `env` | object | Extra environment variables |
| `workingDir` | string | Working directory in sandbox |
| `timeoutMs` | number | Max execution time (≤300 000 ms) |

### Output
`{ command, args, exitCode, stdout, stderr, timedOut, durationMs }`

All output is `EXTERNAL_UNTRUSTED`.

### Safety notes
- No network egress (`no_network_compute` sandbox)
- Approval required per invocation
- Output must not be promoted to control-trusted status

---

## process — `tool.process`

Inspect and manage processes within the sandbox.

**Action class:** `execute` | **Side effects:** `privileged` | **Approval:** required

### Operations
- `list` — list sandbox processes
- `inspect` — inspect a specific PID
- `kill` — send a signal to a PID (irreversible)

### Safety notes
- Scoped to the current sandbox namespace only
- Signal operations are irreversible — approval required

---

## code-execution — `tool.code-execution`

Run code text in a managed language runtime.

**Supported languages:** `python`, `javascript`, `typescript`, `shell`

**Action class:** `execute` | **Approval:** required

### Input
| Field | Type | Description |
|---|---|---|
| `language` | enum | Runtime language |
| `code` | string | Code to execute |
| `timeoutMs` | number | Max execution time (≤120 000 ms) |

### Safety notes
- No network access from code runtime
- Package installation subject to operator allow list

---

## bash — `tool.bash`

Convenience alias for running a bash script through the governed runtime.

Equivalent to `code-execution` with `language=shell` but optimised for multi-line scripts.

**Approval:** required

---

## Default Sets

Runtime tools are included in the **Governed Execute Set** (`manasvi.toolset.governed-execute`).

They are **not** included in read-only sets or the Controlled Write Set. Enable them deliberately.

---

## Policy Requirements

```json
{
  "action": "execute",
  "resource": { "resourceClass": "execution-node" },
  "approvalHint": "must_require"
}
```

All runtime tools require `must_require` approval policy. Configure the approval service and TTL before enabling.

---

## See also

- [Built-in Tools Overview](./overview.md)
- [Default Tool Sets](./default-sets.md)
- [Demo Flows](./demo-flows.md)
- [Troubleshooting](./troubleshooting.md)
