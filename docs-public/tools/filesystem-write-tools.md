# Filesystem Write Tools

Three governed tools for writing to the workspace filesystem: `file-write`, `file-edit`, and `file-apply-patch`. All are scoped to the operator-configured write zone. Path traversal outside the zone is blocked at the runtime boundary.

---

## file-write — `tool.file-write`

Creates or overwrites a file within the write zone.

**Action class:** `write` | **Side effects:** `mutating` | **Approval:** may require

### Input
| Field | Type | Default | Description |
|---|---|---|---|
| `path` | string | — | Path within the write zone |
| `content` | string | — | File content |
| `encoding` | enum | `utf8` | `utf8` or `base64` |
| `overwrite` | boolean | `false` | Allow overwrite of existing files |
| `createDirectories` | boolean | `false` | Create parent directories |

### Safety notes
- `overwrite=false` is the safe default — prevents accidental file destruction
- All writes are recorded in the audit trail

---

## file-edit — `tool.file-edit`

Performs a targeted string replacement in an existing file.

**Action class:** `write` | **Side effects:** `mutating` | **Approval:** may require

### Input
| Field | Type | Default | Description |
|---|---|---|---|
| `path` | string | — | Target file (must exist) |
| `oldString` | string | — | Exact string to replace |
| `newString` | string | — | Replacement |
| `replaceAll` | boolean | `false` | Replace all occurrences |

### Safety notes
- `oldString` must be unique in the file by default (prevents unintended bulk replacements)
- Edit is atomic — file written as a whole after replacement

---

## file-apply-patch — `tool.file-apply-patch`

Applies a unified-diff (git diff) patch to one or more files.

**Action class:** `write` | **Side effects:** `mutating` | **Approval:** required

### Input
| Field | Type | Default | Description |
|---|---|---|---|
| `patch` | string | — | Unified-diff patch text |
| `baseDir` | string | `/workspace` | Base directory for path resolution |
| `dryRun` | boolean | `false` | Preview without writing |

### Safety notes
- Approval required — a patch can modify multiple files simultaneously
- Use `dryRun=true` to review changes before committing
- All patched paths must resolve within the write zone

---

## Default Sets

| Set | Includes |
|---|---|
| `manasvi.toolset.controlled-write` | `file-write`, `file-edit` |
| `manasvi.toolset.governed-execute` | `file-apply-patch` |

---

## Policy Requirements

```json
{
  "action": "access-filesystem",
  "resource": { "resourceClass": "filesystem-zone", "resourceId": "filesystem:workspace-write" }
}
```

Configure the filesystem write zone paths in the execution-manager policy before enabling.

---

## See also

- [Built-in Tools Overview](./overview.md)
- [Default Tool Sets](./default-sets.md)
- [Demo Flows](./demo-flows.md)
- [Troubleshooting](./troubleshooting.md)
