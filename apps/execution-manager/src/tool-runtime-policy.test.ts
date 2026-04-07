import assert from "node:assert/strict";
import test from "node:test";

import { BUILTIN_TOOL_MANIFESTS, createGovernedToolInvocation } from "@manasvi/tool-sdk";
import { createExecutionIntent } from "@manasvi/contracts";

import { mergeRuntimePolicyWithToolHints } from "./tool-runtime-policy.js";

test("tool runtime hints tighten timeout and restrict undeclared secrets", () => {
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
    requestedSecretRefs: ["secret:should-not-pass"],
    trace: {
      traceId: "7f7ce6d6-c072-4235-8496-28cb57e553ce",
      correlationId: "e71f2fc4-2f9a-4374-ad27-f899ca90bde6"
    }
  });
  const intent = createExecutionIntent({
    snapshot: {
      tenantId: "tenant-local",
      workspaceId: "workspace-local",
      actor: invocation.actor,
      caller: invocation.caller,
      trace: invocation.trace,
      action: {
        actionId: "tool.invoke.tool.http-fetch",
        actionClass: "access-network",
        toolRef: manifest!.runtimeBinding.toolRef,
        operation: manifest!.runtimeBinding.operation,
        parameters: invocation.input
      },
      target: {
        resourceClass: "network-zone",
        resourceId: "network:egress",
        tenantId: "tenant-local",
        workspaceId: "workspace-local",
        attributes: {}
      },
      requiredCapabilities: manifest!.capabilities.map((item) => item.capabilityId),
      risk: {
        score: 50,
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
      idempotencyKey: invocation.invocationId
    },
    approval: {
      state: "not_required",
      required: false
    },
    lifecycle: "execution_authorized"
  });

  const merged = mergeRuntimePolicyWithToolHints({
    baseRuntimePolicy: {
      schemaVersion: "1.0",
      policyId: "runtime-policy:test",
      sandboxMode: "restricted_remote",
      timeoutMs: 30_000,
      cpuTimeLimitSeconds: 10,
      memoryLimitMb: 256,
      filesystem: {
        mode: "scratch_write",
        readPaths: [],
        writePaths: []
      },
      network: {
        mode: "allowlist_only",
        egressAllowlist: [{ hostPattern: "example.com", protocol: "https", port: 443 }]
      },
      secrets: {
        allowedSecretRefs: ["secret:should-not-pass"],
        injectedSecretEnvNames: ["MANASVI_SECRET_SECRET_SHOULD_NOT_PASS"]
      },
      cleanup: { removeWorkspaceAfterRun: true },
      derivedFrom: {
        actionClass: "access-network",
        target: {
          resourceClass: "network-zone",
          resourceId: "network:egress",
          attributes: {}
        }
      }
    },
    toolContract: {
      schemaVersion: "1.0",
      contractId: "tool-contract:test",
      invocation,
      manifest: manifest!,
      intent,
      artifact: {
        schemaVersion: "1.0",
        artifactId: "artifact:test",
        intentId: intent.intentId,
        intentVersion: "1.0",
        intentPayloadHash: intent.payloadHash,
        approvalState: "not_required",
        issuedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        issuedByService: "approval-service",
        approvalRecordId: "approval-record:test",
        policyDecisionId: "decision:test",
        trace: invocation.trace,
        signature: {
          algorithm: "hmac-sha256",
          keyId: "local-k1",
          value: "placeholder"
        },
        tokenVersion: "1.0"
      },
      trace: invocation.trace
    }
  });
  assert.equal(merged.timeoutMs <= 15_000, true);
  assert.equal(merged.secrets.allowedSecretRefs.length, 0);
});
