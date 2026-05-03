# Default Tool Sets

Rather than requiring operators to reason about each tool individually, Manasvi provides **default tool sets** — curated, named groups of tools with a defined risk posture.

A tool set is a starting point, not a grant. Enabling a tool set in the registry does not automatically permit invocations. Policy rules in `configs/policies/` must still explicitly allow the relevant action classes.

---

## Available sets

### Starter Safe Set

**Set ID:** `manasvi.toolset.starter-safe`
**Risk level:** Low
**Requires operator config:** Egress allowlist, filesystem read paths

**Included tools:**
- `tool.local-file-read`
- `tool.http-fetch`
- `tool.web-search`

**Best for:**
Informational agents that answer questions, fetch references, and summarise content.
No memory writes. No approval-gated actions. Read-only and search only.

**What to configure:**

1. Add egress allowlist entries for domains you want the agent to reach
2. Set filesystem read paths in execution manager config to scope file access
3. Ensure policy allows `read`, `fetch`, and `search` action classes for agent principals

---

### Notes Set

**Set ID:** `manasvi.toolset.notes`
**Risk level:** Medium
**Requires operator config:** Memory namespace policy

**Included tools:**
- `tool.memory-note-write`

**Best for:**
Agents that need to persist facts, session summaries, or references across conversations.
Combine with the Starter Safe Set for a read + search + remember workflow.

**What to configure:**

1. Configure allowed memory namespaces in policy
2. Add a `mutate-memory` allow rule for the relevant principals
3. Decide which trust classifications you allow (typically `USER_OWNED` and `MODEL_GENERATED_UNTRUSTED`)

---

### Governed Action Set

**Set ID:** `manasvi.toolset.governed-action`
**Risk level:** Low (the tool itself is low risk; the actions it gates may be high risk)
**Requires operator config:** Approval service URL, approval policy

**Included tools:**
- `tool.approval-request`

**Best for:**
Any workflow that requires a human decision before a sensitive action proceeds.
This is Manasvi's primary human-in-the-loop governance primitive.

**What to configure:**

1. Ensure the approval service is running and `APPROVAL_SERVICE_BASE_URL` is set
2. Add an `approve` allow rule for the relevant principals
3. Configure the approval TTL (`executionIntentTtlSeconds` in orchestrator config)

---

### All Built-in Tools

**Set ID:** `manasvi.toolset.all-builtin`
**Risk level:** High
**Requires operator config:** All of the above, plus shell command allowlist

**Included tools:**
- Everything in the Starter Safe Set
- Everything in the Notes Set
- Everything in the Governed Action Set
- `tool.shell-command` (high risk, always requires approval)

**Best for:**
Advanced operator-controlled workflows where shell execution under human approval is needed. Not recommended as a default for agents handling untrusted user input.

**What to configure:**

All of the above, plus:
1. Set `approvalHint: must_require` for shell command in policy
2. Configure the allowed command list in agent prompts or policy conditions
3. Review all policy rules carefully before enabling

---

### Starter Read Set

**Set ID:** `manasvi.toolset.starter-read`
**Risk level:** Low
**Requires operator config:** Egress allowlist, memory namespaces, X API key

**Included tools:**
- `tool.local-file-read`, `tool.http-fetch`, `tool.web-search`, `tool.x-search`
- `tool.memory-get`, `tool.memory-search`
- `tool.agents-list`, `tool.sessions-list`, `tool.sessions-history`, `tool.session-status`
- `tool.nodes`

**Best for:**
Broad read-only agents needing workspace context, session awareness, and memory access. No writes or execution.

---

### Controlled Write Set

**Set ID:** `manasvi.toolset.controlled-write`
**Risk level:** Medium
**Requires operator config:** Filesystem write zone, channel adapter config

**Included tools:**
- `tool.file-write`, `tool.file-edit`
- `tool.sessions-send`, `tool.sessions-yield`
- `tool.canvas`, `tool.message`

**Best for:**
Agents that produce written outputs, send notifications, and continue session workflows. No shell execution.

---

### Governed Execute Set

**Set ID:** `manasvi.toolset.governed-execute`
**Risk level:** High
**Requires operator config:** Sandbox execution policy, approval service config

**Included tools:**
- `tool.exec`, `tool.bash`, `tool.code-execution`, `tool.process`
- `tool.file-apply-patch`, `tool.approval-request`

**Best for:**
Trusted operator-controlled execution workflows. All tools require approval. CI/CD agents, code build agents.

---

### Workflow / Operator Set

**Set ID:** `manasvi.toolset.workflow-operator`
**Risk level:** High
**Requires operator config:** Gateway endpoints, browser runtime, cron scheduler

**Included tools:**
- `tool.cron`, `tool.gateway`
- `tool.subagents`, `tool.sessions-spawn`
- `tool.browser`, `tool.approval-request`

**Best for:**
Advanced operator automation: scheduled tasks, external integrations, multi-agent orchestration, browser automation.

---

## Using tool sets

### CLI

```bash
# View available tool sets
pnpm manasvi tools sets

# View tools in a specific set
pnpm manasvi tools list
```

### API

Tool sets are informational — they describe intent. You enable individual tools via the orchestrator API:

```bash
# Enable a tool
curl -X POST http://localhost:4010/tools/status \
  -H "authorization: Bearer <token>" \
  -H "content-type: application/json" \
  -d '{"toolId": "tool.web-search", "version": "1.0.0", "status": "enabled"}'

# List current tool registry state
curl http://localhost:4010/admin/tools
```

### Programmatic (TypeScript)

```typescript
import { STARTER_SAFE_SET, NOTES_SET, GOVERNED_ACTION_SET, resolveToolSetIds } from "@manasvi/tool-sdk/default-sets";

// Get all tool IDs for the starter safe set
const toolIds = resolveToolSetIds(STARTER_SAFE_SET);
// ["tool.local-file-read", "tool.http-fetch", "tool.web-search"]

// Get all tool sets
import { BUILTIN_TOOL_SETS, describeToolSet } from "@manasvi/tool-sdk/default-sets";
for (const set of BUILTIN_TOOL_SETS) {
  console.log(describeToolSet(set));
}
```

---

## Recommended starting point for new operators

For most deployments, start with the **Starter Safe Set** plus the **Governed Action Set**:

1. Agents can answer questions with web search
2. Agents can read workspace files
3. Sensitive actions pause for human approval

Add the **Notes Set** once you have decided on your memory namespace policy.

Add the **All Built-in Tools** set only if you have a specific need for shell execution and have configured approval properly.

---

## What sets do NOT do

- They do not automatically grant policy permission
- They do not configure egress allowlists
- They do not replace the policy service
- They do not protect against misconfigured policy rules

A tool set is a product-level concept for communicating intent and risk posture. The policy service remains the final authority on what is allowed.
