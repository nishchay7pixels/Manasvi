# Filesystem Write Tools

FS2 adds governed workspace write tools: `tool.fs-write-file`, `tool.fs-append-file`, `tool.fs-apply-patch`, and `tool.fs-rename-file`.
The filesystem is not a capability of the model. It is a governed capability of the Manasvi runtime.
All FS2 writes are workspace-sandboxed, deny-pattern filtered, and approval-gated by default.

---

## fs-write-file — `tool.fs-write-file`

Creates or overwrites a file within the workspace write zone.

**Action class:** `write` | **Side effects:** `mutating` | **Approval:** required by default

### Input
| Field | Type | Default | Description |
|---|---|---|---|
| `path` | string | — | Path within the write zone |
| `content` | string | — | File content |
| `dryRun` | boolean | `false` | Validate and preview without writing |

### Safety notes
- Returns `diff` preview, `hashBefore`, `hashAfter`, and size metadata
- Denylist + workspace-sandbox checks enforced before write

---

## fs-append-file — `tool.fs-append-file`

Appends content to a file in the workspace write zone.

**Action class:** `write` | **Side effects:** `mutating` | **Approval:** required by default

### Input
| Field | Type | Default | Description |
|---|---|---|---|
| `path` | string | — | Target file (must exist) |
| `content` | string | — | Content to append |
| `dryRun` | boolean | `false` | Validate and preview without writing |

### Safety notes
- Returns `diff` preview, `hashBefore`, `hashAfter`, and size metadata
- Denylist + workspace-sandbox checks enforced before append

---

## fs-apply-patch — `tool.fs-apply-patch`

Applies a unified-diff patch to a single target file in the workspace.

**Action class:** `write` | **Side effects:** `mutating` | **Approval:** required by default

### Input
| Field | Type | Default | Description |
|---|---|---|---|
| `path` | string | — | Target file path in workspace |
| `patch` | string | — | Unified-diff patch text |
| `dryRun` | boolean | `false` | Validate and preview without writing |

### Safety notes
- Patch and resulting file size limits enforced
- Use `dryRun=true` to review changes before committing
- Target path must resolve within workspace and pass deny rules

---

## fs-rename-file — `tool.fs-rename-file`

Renames or moves a file within the workspace write zone.

**Action class:** `write` | **Side effects:** `mutating` | **Approval:** required by default

### Input
| Field | Type | Default | Description |
|---|---|---|---|
| `fromPath` | string | — | Source file path in workspace |
| `toPath` | string | — | Destination file path in workspace |
| `dryRun` | boolean | `false` | Validate without renaming |

### Safety notes
- Source and destination must both pass workspace sandbox and deny rules
- Path traversal and sensitive paths are blocked
- Returns structured result with `wouldChange` and `changed` flags

---

## Default Sets

| Set | Includes |
|---|---|
| `manasvi.toolset.controlled-write` | `fs-write-file`, `fs-append-file`, `fs-rename-file` |
| `manasvi.toolset.governed-execute` | `fs-apply-patch` |

---

## Policy Requirements

```json
{
  "action": "access-filesystem",
  "resource": { "resourceClass": "filesystem-zone", "resourceId": "filesystem:workspace-write" }
}
```

Configure the filesystem write zone paths in the execution-manager policy before enabling.

## Legacy tools

Legacy `tool.file-write`, `tool.file-edit`, and `tool.file-apply-patch` may still exist for backward compatibility.
New integrations should use FS2 `tool.fs-*` write tools.

---

## See also

- [Built-in Tools Overview](./overview.md)
- [Default Tool Sets](./default-sets.md)
- [Demo Flows](./demo-flows.md)
- [Troubleshooting](./troubleshooting.md)
