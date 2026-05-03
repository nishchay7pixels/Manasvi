# Memory Tools

Two read-only tools for accessing the governed memory plane: `memory-search` and `memory-get`. Trust classification is preserved per-record — never silently mixed or promoted.

---

## memory-search — `tool.memory-search`

Searches a memory namespace for notes matching a query.

**Action class:** `read-memory` | **Read-only** | **Approval:** none

### Input
| Field | Type | Description |
|---|---|---|
| `namespace` | string | Memory namespace to search |
| `query` | string | Search query |
| `maxResults` | number | Max 50 |
| `trustFilter` | string[] | Optionally limit to specific trust classes |
| `noteTypeFilter` | string[] | Optionally limit to specific note types |
| `tags` | string[] | Filter by tags |

### Trust behaviour
Results include the `trustClassification` field for every record. `EXTERNAL_UNTRUSTED` and `CONTROL_TRUSTED` records appear separately labeled — never mixed.

---

## memory-get — `tool.memory-get`

Retrieves a specific note by ID from a memory namespace.

**Action class:** `read-memory` | **Read-only** | **Approval:** none

Full record returned including `trustClassification`, `provenance`, metadata, and tags.

### Safety notes
- Trust classification is returned as-written — no silent promotion
- `CONTROL_TRUSTED` notes require `read-control-memory` policy
- Namespace isolation prevents cross-tenant access

---

## Default Sets

Both tools are included in `manasvi.toolset.starter-read`.

---

## Policy Requirements

```json
{
  "action": "read",
  "resource": { "resourceClass": "memory-namespace" }
}
```

Configure allowed namespaces in the memory-sdk policy.

---

## See also

- [Built-in Tools Overview](./overview.md)
- [Default Tool Sets](./default-sets.md)
- [Demo Flows](./demo-flows.md)
- [Troubleshooting](./troubleshooting.md)
