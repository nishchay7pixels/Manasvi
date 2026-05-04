# Filesystem Tools (FS1 — Safe Read-Only Access)

**Milestone:** FS1
**Risk level:** Low
**Approval required:** No
**Side effects:** Read-only — no writes, no deletions, no network, no shell

---

## Core principle

> The filesystem is not a capability of the model. It is a governed capability of the Manasvi runtime.

The model may only **propose** filesystem actions. The Manasvi runtime decides whether the action is allowed, validates the path against the workspace sandbox, applies deny patterns, enforces size limits, and records an audit event — before any file is touched.

```
Model proposes path
→ Policy validates the tool invocation
→ Runtime resolves path inside workspace root
→ Deny patterns checked
→ Size limits enforced
→ File read (if all checks pass)
→ Result returned as EXTERNAL_UNTRUSTED
→ Audit event recorded
```

---

## Available tools (FS1)

| Tool ID | What it does | Approval |
|---|---|---|
| `tool.fs-read-file` | Read a text file | Never |
| `tool.fs-list-directory` | List directory contents | Never |
| `tool.fs-stat` | Get file/directory metadata | Never |
| `tool.fs-search-files` | Search file contents for a string | Never |

---

## Workspace sandbox

All FS1 tools are sandboxed to the **workspace root**.

- Default: `./workspace` (relative to where Manasvi services start)
- Configure: `MANASVI_WORKSPACE_ROOT=./workspace` in your `.env`
- The workspace root is resolved to an absolute path at service startup

### Path rules

- Paths are resolved **relative to the workspace root**
- Absolute paths that resolve outside the workspace are blocked
- `../` traversal (e.g. `../../.env`) is blocked
- Symlinks that escape the workspace are blocked

### Examples of blocked paths

```
../secret                   → PATH_OUTSIDE_WORKSPACE
/etc/passwd                 → PATH_OUTSIDE_WORKSPACE
../../home/user/.ssh/id_rsa → PATH_OUTSIDE_WORKSPACE
```

---

## Deny patterns

The following files and directories are blocked **regardless of what the model proposes**. Denied paths are silently omitted from directory listings and search results — their existence is not revealed to the model.

### Blocked filenames and patterns

| Pattern | Examples blocked |
|---|---|
| `.env` | `.env` |
| `.env.*` | `.env.local`, `.env.production` |
| `*.pem` | `cert.pem`, `server.pem` |
| `*.key` | `private.key`, `server.key` |
| `*.crt` | `server.crt`, `ca.crt` |
| `id_rsa` | SSH private key |
| `id_ed25519` | SSH private key |

### Blocked directory components

| Directory | What's blocked |
|---|---|
| `.ssh/` | All SSH key files |
| `.aws/` | AWS credentials |
| `.gcp/` | GCP service account keys |
| `.azure/` | Azure credentials |
| `.git/` | Git internals |
| `node_modules/` | Dependencies |
| `dist/` | Build output |
| `build/` | Build output |
| `coverage/` | Test coverage reports |
| `.next/` | Next.js build cache |
| `.turbo/` | Turbo build cache |
| `.cache/` | Build caches |

---

## Size limits

| Limit | Default | Env var |
|---|---|---|
| Max file read size | 200 000 bytes | `MANASVI_FS_MAX_READ_BYTES` |
| Max directory entries | 500 | `MANASVI_FS_MAX_DIRECTORY_ENTRIES` |
| Max search results | 50 | `MANASVI_FS_MAX_SEARCH_RESULTS` |
| Max file size for search | 200 000 bytes | `MANASVI_FS_MAX_SEARCH_FILE_BYTES` |

Files larger than `MANASVI_FS_MAX_READ_BYTES` return `FILE_TOO_LARGE` instead of content. Directory listings are truncated at `maxDirectoryEntries` with `truncated: true`. Binary files return `BINARY_FILE_NOT_SUPPORTED`.

---

## Tool reference

### `tool.fs-read-file`

Reads a text file from the workspace.

**Input**

| Field | Type | Description |
|---|---|---|
| `path` | string | Workspace-relative path (e.g. `docs/README.md`) |

**Output**

| Field | Type | Description |
|---|---|---|
| `path` | string | Workspace-relative path of the file read |
| `sizeBytes` | number | File size in bytes |
| `content` | string | UTF-8 text content (EXTERNAL_UNTRUSTED) |
| `truncated` | boolean | Always `false` in FS1 — file is rejected if too large |

**Error codes:** `INVALID_PATH`, `PATH_OUTSIDE_WORKSPACE`, `PATH_DENIED`, `FILE_NOT_FOUND`, `FILE_TOO_LARGE`, `BINARY_FILE_NOT_SUPPORTED`

---

### `tool.fs-list-directory`

Lists directory contents within the workspace.

**Input**

| Field | Type | Default | Description |
|---|---|---|---|
| `path` | string | `.` | Workspace-relative directory path |

**Output**

| Field | Type | Description |
|---|---|---|
| `path` | string | Directory listed |
| `entries` | array | Each entry has `name`, `path`, `type` (file/directory), and optional `sizeBytes` |
| `truncated` | boolean | True if more than `maxDirectoryEntries` entries exist |

Denied entries are silently omitted.

---

### `tool.fs-stat`

Returns metadata for a path without reading file contents.

**Input**

| Field | Type | Description |
|---|---|---|
| `path` | string | Workspace-relative path |

**Output**

| Field | Type | Description |
|---|---|---|
| `path` | string | Workspace-relative path |
| `type` | string | `file` or `directory` |
| `sizeBytes` | number | Size in bytes |
| `modifiedAt` | string | ISO-8601 last-modified timestamp |

---

### `tool.fs-search-files`

Searches file contents for a literal string within the workspace.

**Input**

| Field | Type | Default | Description |
|---|---|---|---|
| `query` | string | — | String to search for (case-sensitive literal match) |
| `path` | string | `.` | Workspace-relative directory to search within |

**Output**

| Field | Type | Description |
|---|---|---|
| `query` | string | Query that was searched |
| `searchPath` | string | Directory that was searched |
| `results` | array | Each result has `path`, `line`, and `snippet` (max 200 chars) |
| `truncated` | boolean | True if results were capped at `maxSearchResults` |

Denied files, binary files, and files over `maxSearchFileBytes` are silently skipped.

---

## Error codes

| Code | Meaning |
|---|---|
| `PATH_OUTSIDE_WORKSPACE` | Path resolves outside the workspace root |
| `PATH_DENIED` | Path matches a deny pattern |
| `FILE_NOT_FOUND` | File or directory does not exist |
| `FILE_TOO_LARGE` | File exceeds `maxReadBytes` |
| `BINARY_FILE_NOT_SUPPORTED` | File contains binary data |
| `INVALID_PATH` | Path is empty or a directory when a file is expected |

Stack traces are never returned to the model.

---

## Configuration

Add to your `.env`:

```env
# Filesystem sandbox (FS1)
MANASVI_WORKSPACE_ROOT=./workspace
MANASVI_FS_MAX_READ_BYTES=200000
MANASVI_FS_MAX_DIRECTORY_ENTRIES=500
MANASVI_FS_MAX_SEARCH_RESULTS=50
MANASVI_FS_MAX_SEARCH_FILE_BYTES=200000
```

Create the workspace directory:

```bash
mkdir -p ./workspace
```

Enable the FS1 tool set in your agent configuration:

```json
{ "toolSetId": "manasvi.toolset.fs1-safe-read" }
```

---

## Model behaviour rules

The model should follow these rules when using filesystem tools:

- Only propose filesystem reads when the user has asked to read, list, or search files, or when file content is required to answer.
- Do not propose filesystem tools for general knowledge questions.
- Do not propose write, delete, rename, or shell tools in FS1.
- Request the narrowest path needed — prefer a specific file path over a broad directory listing.
- If a completed filesystem tool result is already in context, use it to answer. Do not re-propose the same read.
- Never claim to have read a file unless a completed tool result confirms it.

---

## What is not supported in FS1

FS1 is intentionally read-only. The following are **not available inside FS1**:

- Writing files (`tool.fs-write-file`, `tool.fs-append-file`)
- Applying patches (`tool.fs-apply-patch`)
- Deleting files
- Creating directories
- Shell execution
- Reading arbitrary absolute paths
- Chunked reading of files larger than `maxReadBytes`

---

## Future milestones

**FS2 (implemented)** — Governed write access:
- Workspace-sandboxed writes with approval-required by default
- `tool.fs-write-file`, `tool.fs-append-file`, `tool.fs-apply-patch`, `tool.fs-rename-file`
- Dry-run diff preview and before/after hash metadata
- Write/patch/diff limits via env config
- Doctor safety checks for writes-without-approval misconfiguration

**FS3 (planned)** — Advanced operations:
- Atomic patch application with rollback
- Directory diff and change tracking
- Configurable recursion depth for search
