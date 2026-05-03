# Tool Invocation Reference

All 30 Manasvi built-in tools. For each tool: ID, a natural language prompt you can send to the agent, and the expected output shape.

**See also:** [Built-in Tools Overview](./overview.md) · [Default Tool Sets](./default-sets.md) · [Demo Flows](./demo-flows.md)

---

## Index

| # | Tool ID | Category |
|---|---|---|
| 1 | [tool.local-file-read](#toollocal-file-read) | Filesystem (read) |
| 2 | [tool.http-fetch](#toolhttp-fetch) | Web |
| 3 | [tool.web-search](#toolweb-search) | Web |
| 4 | [tool.memory-note-write](#toolmemory-note-write) | Memory |
| 5 | [tool.shell-command](#toolshell-command) | Runtime |
| 6 | [tool.approval-request](#toolapproval-request) | Governance |
| 7 | [tool.exec](#toolexec) | Runtime |
| 8 | [tool.process](#toolprocess) | Runtime |
| 9 | [tool.code-execution](#toolcode-execution) | Runtime |
| 10 | [tool.bash](#toolbash) | Runtime |
| 11 | [tool.file-write](#toolfile-write) | Filesystem (write) |
| 12 | [tool.file-edit](#toolfile-edit) | Filesystem (write) |
| 13 | [tool.file-apply-patch](#toolfile-apply-patch) | Filesystem (write) |
| 14 | [tool.sessions-list](#toolsessions-list) | Sessions |
| 15 | [tool.sessions-history](#toolsessions-history) | Sessions |
| 16 | [tool.session-status](#toolsession-status) | Sessions |
| 17 | [tool.sessions-send](#toolsessions-send) | Sessions |
| 18 | [tool.sessions-yield](#toolsessions-yield) | Sessions |
| 19 | [tool.sessions-spawn](#toolsessions-spawn) | Sessions |
| 20 | [tool.subagents](#toolsubagents) | Sessions |
| 21 | [tool.memory-search](#toolmemory-search) | Memory |
| 22 | [tool.memory-get](#toolmemory-get) | Memory |
| 23 | [tool.x-search](#toolx-search) | Web |
| 24 | [tool.browser](#toolbrowser) | UI |
| 25 | [tool.canvas](#toolcanvas) | UI |
| 26 | [tool.cron](#toolcron) | Automation |
| 27 | [tool.gateway](#toolgateway) | Automation |
| 28 | [tool.message](#toolmessage) | Messaging |
| 29 | [tool.nodes](#toolnodes) | Nodes |
| 30 | [tool.agents-list](#toolagents-list) | Agents |

---

## Core Tools (B4)

### tool.local-file-read

**Category:** Filesystem (read) | **Approval:** not required | **Mutability:** read_only

**Prompt to invoke:**
> "Read the file at `./src/config.ts` and summarise what it configures."

**Expected output:**
```json
{
  "path": "./src/config.ts",
  "content": "import { z } from 'zod';\n\nexport const configSchema = ...",
  "encoding": "utf8",
  "bytes": 1420,
  "truncated": false,
  "provenance": {
    "source": "filesystem",
    "trustClassification": "EXTERNAL_UNTRUSTED"
  }
}
```

---

### tool.http-fetch

**Category:** Web | **Approval:** not required | **Mutability:** read_only

**Prompt to invoke:**
> "Fetch `https://httpbin.org/json` and tell me what's in the response."

**Expected output:**
```json
{
  "url": "https://httpbin.org/json",
  "status": 200,
  "contentType": "application/json",
  "body": "{ \"slideshow\": { \"title\": \"Sample Slide Show\" } }",
  "truncated": false,
  "provenance": {
    "source": "remote-http",
    "trustClassification": "EXTERNAL_UNTRUSTED"
  }
}
```

---

### tool.web-search

**Category:** Web | **Approval:** not required | **Mutability:** read_only

**Prompt to invoke:**
> "Search for recent news about TypeScript 5.5 and summarise the top results."

**Expected output:**
```json
{
  "query": "TypeScript 5.5 news",
  "results": [
    {
      "title": "TypeScript 5.5 Release Notes",
      "url": "https://devblogs.microsoft.com/typescript/...",
      "snippet": "TypeScript 5.5 introduces inferred type predicates..."
    },
    {
      "title": "What's new in TypeScript 5.5",
      "url": "https://...",
      "snippet": "..."
    }
  ],
  "provenance": {
    "source": "web-search",
    "trustClassification": "EXTERNAL_UNTRUSTED"
  }
}
```

---

### tool.memory-note-write

**Category:** Memory | **Approval:** not required | **Mutability:** mutating

**Prompt to invoke:**
> "Remember that the API rate limit is 1000 requests per hour."

**Expected output:**
```json
{
  "noteId": "note:1k3x",
  "namespace": "tenant-local/workspace-local/notes/session-abc",
  "persisted": true,
  "trustClassification": "USER_OWNED",
  "createdAt": "2026-05-03T10:00:00.000Z"
}
```

---

### tool.shell-command

**Category:** Runtime | **Approval:** required | **Mutability:** mutating

**Prompt to invoke:**
> "Run `ls -la /tmp/session-data` to list what's in that directory."

**Expected output (after operator approval):**
```json
{
  "exitCode": 0,
  "stdout": "total 16\ndrwxr-xr-x  4 user  staff  128 May  3 10:00 .\n...",
  "stderr": "",
  "durationMs": 38,
  "command": "ls",
  "args": ["-la", "/tmp/session-data"]
}
```

---

### tool.approval-request

**Category:** Governance | **Approval:** not required (creates approval request) | **Mutability:** mutating

**Prompt to invoke:**
> "Submit an approval request for deleting all files in `/tmp/build-cache`."

**Expected output:**
```json
{
  "approvalRequestId": "approval:req789",
  "state": "pending",
  "summary": "Delete all files in /tmp/build-cache",
  "intentId": "intent:del456",
  "expiresAt": "2026-05-03T10:15:00.000Z",
  "createdAt": "2026-05-03T10:00:00.000Z"
}
```

---

## Runtime Tools (B5)

### tool.exec

**Category:** Runtime | **Approval:** required | **Mutability:** mutating

**Prompt to invoke:**
> "Execute `node --version` to confirm which Node.js version is running in the sandbox."

**Expected output (after operator approval):**
```json
{
  "exitCode": 0,
  "stdout": "v22.3.0\n",
  "stderr": "",
  "durationMs": 52,
  "command": "node",
  "args": ["--version"],
  "sandboxMode": "no_network_compute"
}
```

---

### tool.process

**Category:** Runtime | **Approval:** required | **Mutability:** mutating

**Prompt to invoke:**
> "List the currently running sandbox processes."

**Expected output (after operator approval):**
```json
{
  "processes": [
    {
      "pid": 1234,
      "command": "node",
      "args": ["worker.js"],
      "status": "running",
      "cpuPercent": 2.1,
      "memoryMb": 48
    }
  ],
  "total": 1
}
```

---

### tool.code-execution

**Category:** Runtime | **Approval:** required | **Mutability:** mutating

**Prompt to invoke:**
> "Calculate the sum of the first 100 prime numbers using Python."

**Expected output (after operator approval):**
```json
{
  "exitCode": 0,
  "stdout": "24133\n",
  "stderr": "",
  "language": "python",
  "durationMs": 142,
  "sandboxMode": "no_network_compute"
}
```

---

### tool.bash

**Category:** Runtime | **Approval:** required | **Mutability:** mutating

**Prompt to invoke:**
> "Run a bash script that counts the number of `.ts` files in the `src/` directory."

**Expected output (after operator approval):**
```json
{
  "exitCode": 0,
  "stdout": "47\n",
  "stderr": "",
  "durationMs": 88,
  "sandboxMode": "no_network_compute"
}
```

---

## Filesystem Write Tools (B5)

### tool.file-write

**Category:** Filesystem (write) | **Approval:** may require | **Mutability:** mutating

**Prompt to invoke:**
> "Save this analysis to `output/summary.txt`: 'Monthly traffic increased 12% in April.'"

**Expected output:**
```json
{
  "path": "output/summary.txt",
  "bytesWritten": 44,
  "overwritten": false,
  "createdAt": "2026-05-03T10:00:00.000Z"
}
```

---

### tool.file-edit

**Category:** Filesystem (write) | **Approval:** may require | **Mutability:** mutating

**Prompt to invoke:**
> "In `src/config.ts`, replace `timeout: 5000` with `timeout: 10000`."

**Expected output:**
```json
{
  "path": "src/config.ts",
  "replacementsApplied": 1,
  "oldString": "timeout: 5000",
  "newString": "timeout: 10000",
  "replaceAll": false
}
```

---

### tool.file-apply-patch

**Category:** Filesystem (write) | **Approval:** required | **Mutability:** mutating

**Prompt to invoke:**
> "Apply this patch to update the README title: `--- a/README.md\n+++ b/README.md\n@@ -1 +1 @@\n-# Old Title\n+# New Title`"

**Expected output (after operator approval):**
```json
{
  "filesPatched": ["README.md"],
  "hunksApplied": 1,
  "dryRun": false,
  "baseDir": "/workspace"
}
```

---

## Session Tools (B5)

### tool.sessions-list

**Category:** Sessions | **Approval:** not required | **Mutability:** read_only

**Prompt to invoke:**
> "List all currently active sessions."

**Expected output:**
```json
{
  "sessions": [
    {
      "sessionId": "session:abc123",
      "status": "active",
      "tenantId": "tenant-local",
      "workspaceId": "workspace-local",
      "createdAt": "2026-05-03T09:00:00.000Z",
      "iteration": 3
    }
  ],
  "total": 1
}
```

---

### tool.sessions-history

**Category:** Sessions | **Approval:** not required | **Mutability:** read_only

**Prompt to invoke:**
> "Show me the message history for session `session:abc123`."

**Expected output:**
```json
{
  "sessionId": "session:abc123",
  "messages": [
    {
      "role": "user",
      "content": "Search for TypeScript news",
      "timestamp": "2026-05-03T09:01:00.000Z"
    },
    {
      "role": "assistant",
      "content": "Here are the top results...",
      "timestamp": "2026-05-03T09:01:05.000Z"
    }
  ],
  "total": 2
}
```

---

### tool.session-status

**Category:** Sessions | **Approval:** not required | **Mutability:** read_only

**Prompt to invoke:**
> "What is the current status and risk level of session `session:abc123`?"

**Expected output:**
```json
{
  "sessionId": "session:abc123",
  "status": "active",
  "riskLevel": "low",
  "iteration": 3,
  "lastActivityAt": "2026-05-03T09:01:05.000Z",
  "approvalsPending": 0
}
```

---

### tool.sessions-send

**Category:** Sessions | **Approval:** not required | **Mutability:** mutating

**Prompt to invoke:**
> "Send the message 'The build has completed successfully' to session `session:abc123`."

**Expected output:**
```json
{
  "sessionId": "session:abc123",
  "messageId": "msg:xyz456",
  "delivered": true,
  "sentAt": "2026-05-03T10:05:00.000Z"
}
```

---

### tool.sessions-yield

**Category:** Sessions | **Approval:** not required | **Mutability:** mutating

**Prompt to invoke:**
> "Yield a result back to the parent session with the payload `{ status: 'done', count: 42 }`."

**Expected output:**
```json
{
  "sessionId": "session:abc123",
  "yielded": true,
  "payload": { "status": "done", "count": 42 },
  "yieldedAt": "2026-05-03T10:06:00.000Z"
}
```

---

### tool.sessions-spawn

**Category:** Sessions | **Approval:** required | **Mutability:** mutating

**Prompt to invoke:**
> "Spawn a new session using the `agent-def:summariser` agent definition to process this document in the background."

**Expected output (after operator approval):**
```json
{
  "sessionId": "session:new789",
  "agentDefinitionId": "agent-def:summariser",
  "status": "active",
  "parentSessionId": "session:abc123",
  "spawnedAt": "2026-05-03T10:07:00.000Z"
}
```

---

### tool.subagents

**Category:** Sessions | **Approval:** required | **Mutability:** mutating

**Prompt to invoke:**
> "Spawn a subagent using agent definition `agent-def:researcher` to find papers about transformer architectures and return a summary."

**Expected output (after operator approval):**
```json
{
  "subagentSessionId": "session:sub101",
  "agentDefinitionId": "agent-def:researcher",
  "status": "active",
  "spawnedAt": "2026-05-03T10:08:00.000Z"
}
```

---

## Memory Tools (B5)

### tool.memory-search

**Category:** Memory | **Approval:** not required | **Mutability:** read_only

**Prompt to invoke:**
> "Search my saved notes for anything about deadlines this week."

**Expected output:**
```json
{
  "namespace": "tenant-local/workspace-local/notes/user-alice",
  "query": "deadline",
  "results": [
    {
      "noteId": "note:1k3xab",
      "note": "Project alpha milestone due 2026-05-07",
      "noteType": "fact",
      "trustClassification": "USER_OWNED",
      "tags": ["deadline", "project-alpha"],
      "createdAt": "2026-05-01T08:00:00.000Z"
    }
  ],
  "total": 1
}
```

---

### tool.memory-get

**Category:** Memory | **Approval:** not required | **Mutability:** read_only

**Prompt to invoke:**
> "Retrieve the note with ID `note:1k3xab` and show me its full content."

**Expected output:**
```json
{
  "noteId": "note:1k3xab",
  "namespace": "tenant-local/workspace-local/notes/user-alice",
  "note": "Project alpha milestone due 2026-05-07",
  "noteType": "fact",
  "trustClassification": "USER_OWNED",
  "tags": ["deadline", "project-alpha"],
  "createdAt": "2026-05-01T08:00:00.000Z",
  "provenance": {
    "source": "memory-store",
    "trustClassification": "USER_OWNED"
  }
}
```

---

## Web Tools (B5)

### tool.x-search

**Category:** Web | **Approval:** not required | **Mutability:** read_only

**Prompt to invoke:**
> "Search X (Twitter) for recent posts about the Anthropic Claude API and summarise what people are saying."

**Expected output:**
```json
{
  "query": "Anthropic Claude API",
  "results": [
    {
      "id": "tweet:1234567890",
      "text": "Just tried the new Claude API — the tool use is impressively reliable.",
      "author": "@dev_example",
      "postedAt": "2026-05-03T08:30:00.000Z",
      "url": "https://x.com/dev_example/status/1234567890"
    }
  ],
  "provenance": {
    "source": "x-api",
    "trustClassification": "EXTERNAL_UNTRUSTED"
  }
}
```

---

## UI Tools (B5)

### tool.browser

**Category:** UI | **Approval:** required | **Mutability:** mutating

**Prompt to invoke:**
> "Open `https://example.com`, take a screenshot, and describe what the page looks like."

**Expected output (after operator approval):**
```json
{
  "operation": "screenshot",
  "url": "https://example.com",
  "screenshotBase64": "iVBORw0KGgo...",
  "width": 1280,
  "height": 800,
  "provenance": {
    "source": "headless-browser",
    "trustClassification": "EXTERNAL_UNTRUSTED"
  }
}
```

---

### tool.canvas

**Category:** UI | **Approval:** may require | **Mutability:** mutating

**Prompt to invoke:**
> "Render a markdown summary of today's deployment status to the operator dashboard canvas."

**Expected output:**
```json
{
  "operation": "render",
  "format": "markdown",
  "bytesWritten": 312,
  "canvasId": "canvas:main",
  "renderedAt": "2026-05-03T10:10:00.000Z"
}
```

---

## Automation Tools (B5)

### tool.cron

**Category:** Automation | **Approval:** required (for create/delete) | **Mutability:** mutating

**Prompt to invoke:**
> "Schedule a daily job at 8am to search for 'AI safety news' and write a note with the results."

**Expected output (after operator approval):**
```json
{
  "operation": "create",
  "jobId": "cron:job-abc",
  "name": "Daily AI safety digest",
  "schedule": "0 8 * * *",
  "status": "active",
  "nextRunAt": "2026-05-04T08:00:00.000Z",
  "createdAt": "2026-05-03T10:00:00.000Z"
}
```

---

### tool.gateway

**Category:** Automation | **Approval:** required | **Mutability:** mutating

**Prompt to invoke:**
> "Invoke the `erp-system` gateway endpoint to fetch the latest inventory levels."

**Expected output (after operator approval):**
```json
{
  "endpointId": "erp-system",
  "status": 200,
  "responseBody": { "inventory": [{ "sku": "WIDGET-001", "qty": 450 }] },
  "durationMs": 210,
  "provenance": {
    "source": "operator-gateway",
    "trustClassification": "EXTERNAL_UNTRUSTED"
  }
}
```

---

## Messaging Tools (B5)

### tool.message

**Category:** Messaging | **Approval:** may require | **Mutability:** mutating

**Prompt to invoke:**
> "Send a message to the `telegram:ops-alerts` channel saying the build succeeded for version 1.4.2."

**Expected output:**
```json
{
  "messageId": "msg:tg-abc",
  "channel": "telegram:ops-alerts",
  "status": "sent",
  "sentAt": "2026-05-03T10:11:00.000Z"
}
```

---

## Node Tools (B5)

### tool.nodes

**Category:** Nodes | **Approval:** not required (read ops) | **Mutability:** read_only

**Prompt to invoke:**
> "List all available execution nodes and their current status."

**Expected output:**
```json
{
  "operation": "list",
  "nodes": [
    {
      "nodeId": "node:primary",
      "status": "online",
      "capabilities": ["python", "node", "bash"],
      "load": 0.32,
      "region": "local"
    },
    {
      "nodeId": "node:gpu-01",
      "status": "online",
      "capabilities": ["python", "cuda"],
      "load": 0.71,
      "region": "local"
    }
  ],
  "total": 2
}
```

---

## Agent Tools (B5)

### tool.agents-list

**Category:** Agents | **Approval:** not required | **Mutability:** read_only

**Prompt to invoke:**
> "Show me all available agent definitions I can use or spawn."

**Expected output:**
```json
{
  "agents": [
    {
      "agentDefinitionId": "agent-def:summariser",
      "name": "Summariser",
      "capabilities": ["web.search", "memory.write"],
      "toolIds": ["tool.web-search", "tool.memory-note-write"],
      "status": "active",
      "version": "1.0.0"
    },
    {
      "agentDefinitionId": "agent-def:researcher",
      "name": "Researcher",
      "capabilities": ["web.search", "http.fetch"],
      "toolIds": ["tool.web-search", "tool.http-fetch"],
      "status": "active",
      "version": "1.0.0"
    }
  ],
  "total": 2
}
```

---

## Notes on output trust

All outputs from remote/external sources carry `provenance.trustClassification: "EXTERNAL_UNTRUSTED"`. The agent will cite this when using external results in its response. Memory records written by the user carry `USER_OWNED` and that classification is preserved through all subsequent reads.

Tools requiring approval return a `pendingApproval: true` response immediately; the tool result arrives only after the operator acts on the approval request in the admin dashboard.
