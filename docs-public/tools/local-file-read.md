# Local File Read Tool

**Tool ID:** `tool.local-file-read`
**Risk level:** Low
**Approval required:** No
**Side effects:** Read-only — no writes, no network, no memory changes

---

## What it does

The Local File Read tool reads the content of a file from the local filesystem inside a sandboxed child process.

Manasvi may use this tool when a user asks it to:

- Summarise or explain a local file
- Read configuration or data files as part of a task
- Extract specific information from a local document

The file is read in the `read_only_local` sandbox. No network access is permitted during the read operation. Filesystem writes are blocked.

---

## Risk profile

This is the lowest-risk built-in tool.

- It is **read-only**: no file can be modified, created, or deleted
- **Path traversal is blocked**: the sandbox enforces that reads only reach paths within the declared `filesystem-zone` read paths
- **Output is `EXTERNAL_UNTRUSTED`**: file content is not automatically trusted and must not be used to drive control-plane decisions without review

---

## When approval is needed

Approval is **not required** by default for this tool. However, policy can be configured to require approval for specific filesystem zones or principal types.

If policy returns `REQUIRE_APPROVAL` for a file read request, the intent will pause and wait for a human decision.

---

## Input

| Field | Required | Description |
|---|---|---|
| `path` | Yes | Absolute or workspace-relative path to the file |
| `encoding` | No | `utf8` (default) or `base64` for binary files |
| `maxBytes` | No | Maximum bytes to read (defaults to sandbox limit, ~512 KB) |

---

## Output

| Field | Description |
|---|---|
| `path` | The path that was read |
| `encoding` | Encoding used |
| `content` | File content as a string (EXTERNAL_UNTRUSTED) |
| `bytes` | Bytes read before encoding |
| `truncated` | `true` if the file exceeded the read limit |
| `provenance` | Source and trust classification metadata |

---

## What operators need to configure

**Filesystem read paths** must be configured in the execution manager's policy. By default, reads are restricted to the sandbox input directory.

To allow reading from a custom directory, add an entry to the egress/filesystem policy section.

The policy action class for this tool is `read` on resource class `filesystem-zone`. Your policy rules must include an `allow` effect for this combination for the relevant principal types.

```json
{
  "effect": "allow",
  "actionClasses": ["read"],
  "resourceClasses": ["filesystem-zone"],
  "conditions": {}
}
```

---

## How to enable or disable

This tool ships enabled. To disable it:

```bash
curl -X POST http://localhost:4010/tools/status \
  -H "authorization: Bearer <token>" \
  -H "content-type: application/json" \
  -d '{"toolId": "tool.local-file-read", "version": "1.0.0", "status": "disabled"}'
```

Or inspect its current status via:

```bash
pnpm manasvi tools inspect tool.local-file-read
```

---

## Example usage

**User asks:** "Can you read and summarise the file at `/workspace/notes/meeting.txt`?"

**Visible flow:**

1. Orchestrator resolves `tool.local-file-read` in the registry — `enabled`
2. Input validation passes: `{ path: "/workspace/notes/meeting.txt" }`
3. Policy evaluates `read` on `filesystem-zone` — `ALLOW`
4. Execution intent created, signed, system artifact issued
5. Execution manager verifies contract; derives `read_only_local` sandbox policy
6. Sandboxed child process reads the file
7. Output returned: `{ content: "...", bytes: 1842, truncated: false }`
8. Agent incorporates content into its response

See [Demo Flows](./demo-flows.md#demo-flow-a--file-read) for a full end-to-end walkthrough.

---

## If this tool is denied

| Reason | What to check |
|---|---|
| `TOOL_NOT_ENABLED` | Tool is disabled — enable via `/tools/status` |
| `POLICY_DENIED` | No allow rule for `read` on `filesystem-zone` for this principal |
| `FS_READ_BLOCKED` | Path is outside the declared sandbox read paths |
| Input validation failed | `path` is missing or empty |

See [Troubleshooting](./troubleshooting.md) for more.

---

## See also

- [Built-in Tools Overview](./overview.md)
- [Default Tool Sets](./default-sets.md)
- [Demo Flows](./demo-flows.md)
- [Troubleshooting](./troubleshooting.md)
