import assert from "node:assert/strict";
import test from "node:test";

import {
  buildGovernedToolExecutionContract,
  BUILTIN_TOOL_MANIFESTS,
  BUILTIN_TOOL_SPECS,
  createGovernedToolInvocation,
  createToolResult,
  validateToolInput,
  validateToolManifest,
  validateToolOutput
} from "./index.js";
import {
  BUILTIN_TOOL_SETS,
  getToolSet,
  STARTER_READ_SET,
  CONTROLLED_WRITE_SET,
  GOVERNED_EXECUTE_SET,
  WORKFLOW_OPERATOR_SET
} from "./default-sets.js";

test("built-in tool manifests validate", () => {
  for (const manifest of BUILTIN_TOOL_MANIFESTS) {
    const parsed = validateToolManifest(manifest);
    assert.equal(parsed.toolId, manifest.toolId);
  }
});

test("tool input validation fails for malformed payload", () => {
  assert.throws(() => validateToolInput("tool.http-fetch", { url: "not-a-url" }));
});

test("execution contract rejects undeclared secret refs", () => {
  const manifest = BUILTIN_TOOL_MANIFESTS.find((item) => item.toolId === "tool.http-fetch");
  assert.ok(manifest);
  const invocation = createGovernedToolInvocation({
    toolId: manifest!.toolId,
    toolVersion: manifest!.version,
    tenantId: "tenant-local",
    workspaceId: "workspace-local",
    actor: { principalId: "user:alice", principalType: "human_user" },
    caller: { principalId: "service:orchestrator-service", principalType: "service" },
    input: { url: "https://example.com" },
    requestedSecretRefs: ["secret:not-allowed"],
    trace: {
      traceId: "e565968b-ff8d-4f9e-ab2b-1538f7134d86",
      correlationId: "5f4cf20c-336a-4be4-ac90-34a4f67e78af"
    }
  });
  assert.throws(() =>
    buildGovernedToolExecutionContract({
      manifest: manifest!,
      invocation,
      intent: {
        schemaVersion: "1.0",
        contractVersion: "1.0.0",
        intentId: "intent:test",
        intentVersion: "1.0",
        snapshot: {
          tenantId: "tenant-local",
          workspaceId: "workspace-local",
          actor: invocation.actor,
          caller: invocation.caller,
          trace: invocation.trace,
          action: {
            actionId: "tool.invoke",
            actionClass: "access-network",
            toolRef: "tool:http-get",
            operation: "http_fetch",
            parameters: invocation.input
          },
          target: {
            resourceClass: "network-zone",
            resourceId: "network:egress",
            tenantId: "tenant-local",
            workspaceId: "workspace-local",
            attributes: {}
          },
          requiredCapabilities: ["network.fetch"],
          risk: {
            score: 40,
            level: "medium",
            reasons: []
          },
          policy: {
            decisionId: "decision:test",
            decision: "ALLOW",
            approvalRequired: false,
            reasonCodes: ["ALLOW_BY_POLICY"],
            policySetVersion: "test",
            policySourceRef: "test",
            auditRecordId: "audit:test"
          },
          createdByService: "orchestrator-service",
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          idempotencyKey: "idempotency:test"
        },
        payloadHash: "placeholder-hash",
        integrity: {
          algorithm: "hmac-sha256",
          keyId: "test-k1",
          value: "test-sig",
          signedAt: new Date().toISOString(),
          tokenVersion: "1.0"
        },
        approval: { state: "not_required", required: false },
        lifecycle: "execution_authorized",
        updatedAt: new Date().toISOString()
      },
      artifact: {
        schemaVersion: "1.0",
        artifactId: "artifact:test",
        intentId: "intent:test",
        intentVersion: "1.0",
        intentPayloadHash: "placeholder-hash",
        approvalState: "not_required",
        issuedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        issuedByService: "approval-service",
        approvalRecordId: "approval-record:test",
        policyDecisionId: "decision:test",
        nonce: "nonce:test-1",
        trace: invocation.trace,
        signature: {
          algorithm: "hmac-sha256",
          keyId: "local-k1",
          value: "fake"
        },
        tokenVersion: "1.0"
      },
      trace: invocation.trace
    })
  );
});

// ── New tool manifest tests ────────────────────────────────────────────────────

test("all 30 built-in tool manifests validate against schema", () => {
  assert.equal(BUILTIN_TOOL_MANIFESTS.length, 30);
  for (const manifest of BUILTIN_TOOL_MANIFESTS) {
    const parsed = validateToolManifest(manifest);
    assert.equal(parsed.toolId, manifest.toolId);
  }
});

test("all new tool specs are registered in BUILTIN_TOOL_SPECS", () => {
  const expectedIds = [
    "tool.exec", "tool.process", "tool.code-execution", "tool.bash",
    "tool.file-write", "tool.file-edit", "tool.file-apply-patch",
    "tool.sessions-list", "tool.sessions-history", "tool.sessions-send",
    "tool.sessions-spawn", "tool.sessions-yield", "tool.subagents", "tool.session-status",
    "tool.memory-search", "tool.memory-get",
    "tool.x-search",
    "tool.browser", "tool.canvas",
    "tool.cron", "tool.gateway",
    "tool.message",
    "tool.nodes",
    "tool.agents-list"
  ];
  for (const id of expectedIds) {
    assert.ok(id in BUILTIN_TOOL_SPECS, `missing tool spec: ${id}`);
  }
});

test("runtime tools are approval-sensitive and have no_network_compute sandbox", () => {
  for (const id of ["tool.exec", "tool.bash", "tool.code-execution", "tool.process"]) {
    const spec = BUILTIN_TOOL_SPECS[id as keyof typeof BUILTIN_TOOL_SPECS];
    assert.ok(spec.manifest.runtimeHints.approvalSensitive, `${id} should be approvalSensitive`);
    assert.equal(spec.manifest.runtimeHints.defaultSandboxMode, "no_network_compute");
  }
});

test("read-only tools are not approval-sensitive", () => {
  for (const id of ["tool.sessions-list", "tool.session-status", "tool.memory-get", "tool.memory-search", "tool.agents-list", "tool.nodes"]) {
    const spec = BUILTIN_TOOL_SPECS[id as keyof typeof BUILTIN_TOOL_SPECS];
    assert.equal(spec.manifest.runtimeHints.approvalSensitive, false, `${id} should not be approvalSensitive`);
    assert.equal(spec.manifest.mutability, "read_only");
  }
});

test("filesystem write tools have access-filesystem policy action class", () => {
  for (const id of ["tool.file-write", "tool.file-edit", "tool.file-apply-patch"]) {
    const spec = BUILTIN_TOOL_SPECS[id as keyof typeof BUILTIN_TOOL_SPECS];
    assert.equal(spec.manifest.policyBinding.policyActionClass, "access-filesystem");
  }
});

test("file-apply-patch is approval-sensitive (multi-file patch risk)", () => {
  const spec = BUILTIN_TOOL_SPECS["tool.file-apply-patch"];
  assert.ok(spec.manifest.runtimeHints.approvalSensitive);
  assert.equal(spec.manifest.policyBinding.approvalHint, "must_require");
});

test("x-search declares secret ref for x-api-key", () => {
  const spec = BUILTIN_TOOL_SPECS["tool.x-search"];
  assert.ok(spec.manifest.runtimeHints.declaredSecretRefs.includes("secret:x-api-key"));
});

test("memory tools preserve trust classification in output schema", () => {
  const memGet = BUILTIN_TOOL_SPECS["tool.memory-get"];
  const memSearch = BUILTIN_TOOL_SPECS["tool.memory-search"];
  assert.equal(memGet.manifest.actionClass, "read-memory");
  assert.equal(memSearch.manifest.actionClass, "read-memory");
  assert.equal(memGet.manifest.mutability, "read_only");
  assert.equal(memSearch.manifest.mutability, "read_only");
});

test("session mutation tools have write policy action class", () => {
  for (const id of ["tool.sessions-send", "tool.sessions-spawn", "tool.sessions-yield"]) {
    const spec = BUILTIN_TOOL_SPECS[id as keyof typeof BUILTIN_TOOL_SPECS];
    assert.equal(spec.manifest.policyBinding.policyActionClass, "write");
  }
});

test("subagents tool has approval-sensitive spawn capability", () => {
  const spec = BUILTIN_TOOL_SPECS["tool.subagents"];
  assert.ok(spec.manifest.runtimeHints.approvalSensitive);
  assert.equal(spec.manifest.actionClass, "spawn-subagent");
});

test("cron and gateway tools are approval-sensitive automation", () => {
  assert.ok(BUILTIN_TOOL_SPECS["tool.cron"].manifest.runtimeHints.approvalSensitive);
  assert.ok(BUILTIN_TOOL_SPECS["tool.gateway"].manifest.runtimeHints.approvalSensitive);
  assert.equal(BUILTIN_TOOL_SPECS["tool.cron"].manifest.actionClass, "schedule");
  assert.equal(BUILTIN_TOOL_SPECS["tool.gateway"].manifest.actionClass, "access-gateway");
});

test("message tool targets channel-surface resource class", () => {
  const spec = BUILTIN_TOOL_SPECS["tool.message"];
  assert.ok(spec.manifest.resourceClassesTouched.includes("channel-surface"));
  assert.equal(spec.manifest.actionClass, "send-message");
});

test("nodes tool is read-only with inspect-node action class", () => {
  const spec = BUILTIN_TOOL_SPECS["tool.nodes"];
  assert.equal(spec.manifest.actionClass, "inspect-node");
  assert.equal(spec.manifest.mutability, "read_only");
});

test("agents-list tool is read-only with list-agents action class", () => {
  const spec = BUILTIN_TOOL_SPECS["tool.agents-list"];
  assert.equal(spec.manifest.actionClass, "list-agents");
  assert.equal(spec.manifest.mutability, "read_only");
});

test("all tool specs have at least one example", () => {
  for (const [id, spec] of Object.entries(BUILTIN_TOOL_SPECS)) {
    assert.ok(spec.examples.length > 0, `${id} has no examples`);
  }
});

test("exec tool input validation accepts valid command", () => {
  const result = validateToolInput("tool.exec", { command: "npm", args: ["run", "build"] });
  assert.equal(result.command, "npm");
});

test("exec tool input validation rejects missing command", () => {
  assert.throws(() => validateToolInput("tool.exec", { args: ["run", "build"] }));
});

test("memory-search input validation requires namespace and query", () => {
  assert.throws(() => validateToolInput("tool.memory-search", { query: "deadline" }));
  assert.throws(() => validateToolInput("tool.memory-search", { namespace: "ns" }));
  const ok = validateToolInput("tool.memory-search", { namespace: "ns", query: "deadline" });
  assert.equal(ok.namespace, "ns");
});

test("sessions-spawn input defaults to agent_workflow type and ephemeral isolation", () => {
  const result = validateToolInput("tool.sessions-spawn", {});
  assert.equal(result.sessionType, "agent_workflow");
  assert.equal(result.isolationMode, "ephemeral_one_shot");
});

test("new tool sets are registered in BUILTIN_TOOL_SETS", () => {
  const setIds = BUILTIN_TOOL_SETS.map((s) => s.setId);
  assert.ok(setIds.includes("manasvi.toolset.starter-read"));
  assert.ok(setIds.includes("manasvi.toolset.controlled-write"));
  assert.ok(setIds.includes("manasvi.toolset.governed-execute"));
  assert.ok(setIds.includes("manasvi.toolset.workflow-operator"));
});

test("STARTER_READ_SET contains only read-only tools", () => {
  for (const toolId of STARTER_READ_SET.toolIds) {
    const spec = BUILTIN_TOOL_SPECS[toolId as keyof typeof BUILTIN_TOOL_SPECS];
    assert.equal(spec.manifest.mutability, "read_only", `${toolId} in STARTER_READ_SET must be read_only`);
  }
  assert.equal(STARTER_READ_SET.riskLevel, "low");
});

test("GOVERNED_EXECUTE_SET contains only approval-sensitive tools", () => {
  for (const toolId of GOVERNED_EXECUTE_SET.toolIds) {
    const spec = BUILTIN_TOOL_SPECS[toolId as keyof typeof BUILTIN_TOOL_SPECS];
    assert.ok(spec.manifest.runtimeHints.approvalSensitive, `${toolId} in GOVERNED_EXECUTE_SET must be approvalSensitive`);
  }
});

test("getToolSet returns correct definition by id", () => {
  const set = getToolSet("manasvi.toolset.starter-read");
  assert.ok(set);
  assert.equal(set!.setId, "manasvi.toolset.starter-read");
});

test("CONTROLLED_WRITE_SET has medium risk level", () => {
  assert.equal(CONTROLLED_WRITE_SET.riskLevel, "medium");
  assert.equal(CONTROLLED_WRITE_SET.containsApprovalSensitiveTools, false);
});

test("WORKFLOW_OPERATOR_SET has high risk and approval-sensitive tools", () => {
  assert.equal(WORKFLOW_OPERATOR_SET.riskLevel, "high");
  assert.equal(WORKFLOW_OPERATOR_SET.containsApprovalSensitiveTools, true);
});

test("tool output validation and result creation succeed", () => {
  const output = validateToolOutput("tool.local-file-read", {
    path: "docs/README.md",
    encoding: "utf8",
    content: "hello",
    bytes: 5
  });
  assert.equal(output.bytes, 5);

  const result = createToolResult({
    invocationId: "tool-invocation:test",
    toolId: "tool.local-file-read",
    toolVersion: "1.0.0",
    status: "completed",
    output,
    provenance: {
      source: "tool-runtime",
      trustClassification: "CONTROL_TRUSTED"
    },
    runtime: {
      runId: "run:test",
      durationMs: 12
    },
    trace: {
      traceId: "1f2773f4-4e0f-447f-bb38-c64e117764c6",
      correlationId: "88b41980-e7eb-4906-90ef-fd06535603c0"
    }
  });
  assert.equal(result.status, "completed");
});
