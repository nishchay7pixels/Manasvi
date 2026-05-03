# Automation Tools

Two operator-level tools for scheduled and gateway-integrated automation: `cron` and `gateway`.

---

## cron — `tool.cron`

Manages scheduled tasks (cron jobs) in the automation plane.

**Action class:** `schedule` | **Side effects:** `mutating` | **Approval:** required

### Operations

| Operation | Description |
|---|---|
| `create` | Create a scheduled job with a cron expression |
| `list` | List all cron jobs |
| `pause` | Pause a running job |
| `resume` | Resume a paused job |
| `delete` | Delete a job |
| `trigger` | Trigger a manual run |

### Safety notes
- Approval required for `create` and `delete` — schedules are persistent side effects
- Scheduled jobs execute under the creating principal's policy constraints
- Cron job outputs are audited identically to direct invocations
- Cron expressions are validated before acceptance

### Example

```json
{
  "operation": "create",
  "schedule": "0 8 * * *",
  "name": "Daily status digest",
  "taskDefinition": {
    "toolId": "tool.web-search",
    "input": { "query": "AI safety news", "maxResults": 5 }
  }
}
```

---

## gateway — `tool.gateway`

Invokes operator-configured gateway endpoints for system-level integrations.

**Action class:** `access-gateway` | **Side effects:** `external_side_effect` | **Approval:** required

### Safety notes
- Only operator-registered endpoints are reachable — agents cannot invoke arbitrary endpoints
- Gateway responses are `EXTERNAL_UNTRUSTED`
- Approval required: gateway integrations can trigger real-world side effects

### Setup

1. Register gateway endpoints in the execution-manager config
2. Configure `gateway.invoke` capability and egress allowlist
3. Grant `external-side-effect` policy for `service:operator-gateway`

---

## Default Sets

Both tools are included in `manasvi.toolset.workflow-operator`.

---

## See also

- [Built-in Tools Overview](./overview.md)
- [Default Tool Sets](./default-sets.md)
- [Demo Flows](./demo-flows.md)
- [Troubleshooting](./troubleshooting.md)
