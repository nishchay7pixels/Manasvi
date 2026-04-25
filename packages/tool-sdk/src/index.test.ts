import assert from "node:assert/strict";
import test from "node:test";

import {
  buildGovernedToolExecutionContract,
  BUILTIN_TOOL_MANIFESTS,
  createGovernedToolInvocation,
  createToolResult,
  validateToolInput,
  validateToolManifest,
  validateToolOutput
} from "./index.js";

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
