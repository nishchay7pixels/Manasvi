# Tool Demo Flows

These flows demonstrate real Manasvi tool use with visible policy and execution mediation.

Each flow shows:
- The user request
- Which tool is proposed
- The policy check
- Execution path
- What the operator can observe

All flows assume services are running. Start them with `pnpm manasvi start`.

---

## Demo Flow A — File Read

**User asks:** "Read the file at `./README.md` and give me a summary."

### What happens

```
1. Request arrives at orchestrator
   └─ principal: user:alice  tenant: tenant-local  workspace: workspace-local

2. Policy evaluated for orchestration
   └─ action: invoke  resource: agent:default-planner
   └─ decision: ALLOW

3. Agent plans: tool.local-file-read with input { path: "./README.md" }

4. Tool lookup: tool.local-file-read  status: enabled  ✓

5. Input validation: { path: "./README.md", encoding: "utf8" }  ✓

6. Policy evaluated for tool invocation
   └─ action: read  resource: filesystem-zone:workspace
   └─ principal capabilities: [filesystem.read]
   └─ decision: ALLOW

7. Execution intent created
   └─ intentId: intent:abc123
   └─ payloadHash: sha256(snapshot)
   └─ signature: HMAC-SHA256(...)

8. System approval artifact issued (no human approval required)
   └─ artifactId: artifact:xyz789
   └─ approvalState: not_required

9. Tool execution contract built and dispatched to execution-manager

10. Execution-manager verifies contract:
    └─ intent signature valid  ✓
    └─ artifact signature valid  ✓
    └─ nonce not consumed  ✓
    └─ artifact not expired  ✓

11. Runtime policy derived:
    └─ sandboxMode: read_only_local
    └─ filesystem: read_only_inputs
    └─ network: none
    └─ timeoutMs: 8000

12. Sandboxed child process reads README.md
    └─ content: "# Manasvi\n\nA secure, policy-driven..."
    └─ bytes: 2847  truncated: false

13. Output validation passes  ✓

14. Result returned to orchestrator
    └─ provenance: { source: "filesystem", trustClassification: "EXTERNAL_UNTRUSTED" }

15. Agent produces summary:
    "Manasvi is a secure, policy-driven agent operating fabric. [...]"
```

### What the operator can see

```bash
# Check execution integrity audit
curl http://localhost:4011/execution/audit/integrity

# Check orchestration event result
curl "http://localhost:4010/orchestration/event-results?eventId=<eventId>" \
  -H "authorization: Bearer <token>"

# Check tool registry
curl http://localhost:4010/admin/tools | jq '.tools[] | select(.toolId == "tool.local-file-read")'
```

---

## Demo Flow B — HTTP Fetch

**User asks:** "Fetch `https://httpbin.org/json` and tell me what's in it."

### What happens

```
1. Request arrives, policy evaluated → ALLOW

2. Agent plans: tool.http-fetch with input { url: "https://httpbin.org/json" }

3. Tool lookup: tool.http-fetch  status: enabled  ✓

4. Input validation passes  ✓

5. Policy evaluated:
   └─ action: access-network  resource: network-zone:egress
   └─ decision: ALLOW

6. Intent created → system artifact issued

7. Execution-manager verifies contract  ✓

8. Runtime policy:
   └─ sandboxMode: restricted_remote
   └─ network: allowlist_only
   └─ egressAllowlist: [{ hostPattern: "*", port: 443, protocol: "https" }]

9. Sandbox checks: httpbin.org:443 → in allowlist  ✓

10. fetch("https://httpbin.org/json") runs in sandbox

11. Result:
    └─ status: 200
    └─ preview: '{ "slideshow": { "title": "Sample Slide Show", ... } }'
    └─ contentType: "application/json"
    └─ truncated: false
    └─ provenance: { source: "remote-http", trustClassification: "EXTERNAL_UNTRUSTED" }

12. Agent responds: "The JSON contains a slideshow object with [...]"
```

## Demo Flow B2 — Web Search

**User asks:** "Search for recent news about TypeScript 5.5."

### What happens

```
1. Request arrives, policy evaluated → ALLOW

2. Agent plans: tool.web-search with input { query: "TypeScript 5.5 news", maxResults: 5 }

3. Tool lookup: tool.web-search  status: enabled  ✓

4. Policy evaluated:
   └─ action: access-network  resource: network-zone:web-search
   └─ decision: ALLOW

5. Intent created → system artifact issued

6. Sandboxed execution in restricted_remote mode
   └─ DuckDuckGo Instant Answer API queried

7. Results returned:
   [
     { title: "TypeScript 5.5 Release Notes", url: "...", snippet: "TypeScript 5.5 introduces..." },
     { title: "What's new in TypeScript 5.5", url: "...", snippet: "..." }
   ]
   └─ provenance: { source: "web-search", trustClassification: "EXTERNAL_UNTRUSTED" }

8. Agent responds using results as external references:
   "Based on web search results (external, untrusted), TypeScript 5.5 includes [...]"
```

---

## Demo Flow C — Note Write

**User asks:** "Remember that the API rate limit is 1000 requests per hour."

### What happens

```
1. Request arrives, policy evaluated → ALLOW

2. Agent plans: tool.memory-note-write with input:
   {
     namespace: "tenant-local/workspace-local/notes/session-abc",
     note: "API rate limit is 1000 requests per hour",
     noteType: "fact",
     trustClassification: "USER_OWNED",
     tags: ["api", "rate-limit"]
   }

3. Tool lookup: tool.memory-note-write  status: enabled  ✓

4. Input validation passes  ✓

5. Policy evaluated:
   └─ action: mutate-memory  resource: memory-namespace:notes
   └─ trustClassification in allowed set: USER_OWNED  ✓
   └─ decision: ALLOW

6. Intent created → system artifact issued

7. Execution-manager verifies contract  ✓

8. Runtime policy:
   └─ sandboxMode: read_only_local
   └─ network: none
   └─ filesystem: scratch_write

9. Sandbox runs tool:memory-write handler:
   └─ namespace: "tenant-local/workspace-local/notes/session-abc"
   └─ noteId: "note:1k3x"
   └─ persisted: true
   └─ trustClassification: "USER_OWNED"
   └─ createdAt: "2026-04-27T12:34:56.789Z"

10. Result:
    {
      noteId: "note:1k3x",
      namespace: "tenant-local/workspace-local/notes/session-abc",
      persisted: true,
      trustClassification: "USER_OWNED"
    }

11. Agent responds: "I've remembered that the API rate limit is 1000 requests per hour."
```

### What the operator can see

```bash
# Query memory records
curl "http://localhost:4012/memory/records?namespace=tenant-local/workspace-local/notes/session-abc" \
  -H "authorization: Bearer <token>"
```

---

## Demo Flow D — Approval Request

**User asks:** "Delete all temp files in `/tmp/session-data`."

This request triggers shell command execution, which requires human approval.

### What happens

```
1. Request arrives, policy evaluated → ALLOW (for orchestration)

2. Agent plans: tool.shell-command with input:
   { command: "rm", args: ["-rf", "/tmp/session-data"], allowedCommands: ["rm"] }

3. Tool lookup: tool.shell-command  status: enabled  ✓

4. Policy evaluated:
   └─ action: execute  resource: tool-endpoint:shell-command
   └─ approvalHint: must_require
   └─ decision: REQUIRE_APPROVAL

5. Execution intent created (approval: pending)
   └─ intentId: intent:del456
   └─ payloadHash: sha256(snapshot)

6. Approval request created:
   └─ approvalRequestId: approval:req789
   └─ state: pending
   └─ summary: "Execute shell command: rm -rf /tmp/session-data"

7. Orchestrator returns 202 to the agent turn:
   {
     "pendingApproval": true,
     "intentId": "intent:del456",
     "approvalRequestId": "approval:req789",
     "state": "pending"
   }

8. Agent informs the user:
   "This action requires operator approval. I've submitted a request (ID: approval:req789)."

--- OPERATOR REVIEWS ---

9. Operator sees pending approval in admin dashboard
   └─ Summary: "Execute shell command: rm -rf /tmp/session-data"
   └─ Principal: user:alice
   └─ Created: 2026-04-27T12:35:00Z
   └─ Expires: 2026-04-27T12:50:00Z

10a. Operator approves:
   └─ POST /orchestration/execution-intents/approval-decision
      { decision: "approved", reason: "Confirmed with user that /tmp/session-data is safe to remove" }
   └─ ApprovedIntentArtifact issued  ✓
   └─ Execution proceeds through execution-manager
   └─ Shell command runs in no_network_compute sandbox

10b. Operator rejects:
   └─ POST /orchestration/execution-intents/approval-decision
      { decision: "rejected", reason: "Not authorised to delete system temp files" }
   └─ Intent state: rejected
   └─ User informed: "The action was not approved by the operator."
```

### Approval state is visible at every step

```bash
# Check intent and approval state
curl "http://localhost:4010/orchestration/execution-intents?intentId=intent:del456" \
  -H "authorization: Bearer <token>"

# Check approval service directly
curl "http://localhost:4015/approvals/requests/approval:req789" \
  -H "authorization: Bearer <token>"

# Integrity audit
curl http://localhost:4011/execution/audit/integrity
```

---

## Running the demos interactively

If you have the services running, you can invoke tool flows directly via the agent turn API:

```bash
# Start services
pnpm manasvi start

# Issue a service token
TOKEN=$(curl -s -X POST http://localhost:4010/auth/token \
  -H "content-type: application/json" \
  -d '{"caller": "user:demo", "scopes": ["agent.invoke"]}' | jq -r .token)

# Run a file read demo
curl -X POST http://localhost:4010/agent-runtime/turn \
  -H "authorization: Bearer $TOKEN" \
  -H "content-type: application/json" \
  -d '{
    "tenantId": "tenant-local",
    "workspaceId": "workspace-local",
    "messageText": "Read the file at ./README.md and summarise it"
  }'

# Run a web search demo
curl -X POST http://localhost:4010/agent-runtime/turn \
  -H "authorization: Bearer $TOKEN" \
  -H "content-type: application/json" \
  -d '{
    "tenantId": "tenant-local",
    "workspaceId": "workspace-local",
    "messageText": "Search for recent news about TypeScript 5.5"
  }'

# Invoke a tool directly (bypasses planning loop)
curl -X POST http://localhost:4010/tools/invoke \
  -H "authorization: Bearer $TOKEN" \
  -H "content-type: application/json" \
  -d '{
    "tenantId": "tenant-local",
    "workspaceId": "workspace-local",
    "toolId": "tool.web-search",
    "input": { "query": "Manasvi AI agent framework", "maxResults": 3 }
  }'
```
