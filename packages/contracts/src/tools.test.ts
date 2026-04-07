import assert from "node:assert/strict";
import test from "node:test";

import { createToolInvocationRequest, toolManifestSchema } from "./tools.js";

test("tool manifest rejects missing capability declarations", () => {
  const now = new Date().toISOString();
  const parsed = toolManifestSchema.safeParse({
    schemaVersion: "1.0",
    contractVersion: "1.0.0",
    toolId: "tool.invalid",
    name: "Invalid Tool",
    version: "1.0.0",
    description: "invalid",
    owner: "owner",
    provider: "provider",
    type: "built_in",
    actionClass: "read",
    sideEffectClass: "read_only",
    mutability: "read_only",
    capabilities: [],
    resourceClassesTouched: ["filesystem-zone"],
    inputSchema: { type: "object", properties: {} },
    outputSchema: { type: "object", properties: {} },
    runtimeHints: {
      defaultTimeoutMs: 1000,
      defaultSandboxMode: "read_only_local",
      egressProfiles: [],
      filesystemProfile: "none",
      declaredSecretRefs: [],
      requireExecutorPath: true,
      approvalSensitive: false
    },
    runtimeBinding: {
      toolRef: "tool:invalid",
      operation: "invalid"
    },
    policyBinding: {
      policyActionClass: "read",
      resource: {
        resourceClass: "tool-endpoint",
        resourceId: "tool:invalid"
      },
      requiresExplicitPolicy: true,
      approvalHint: "none"
    },
    trustNotes: [],
    tags: [],
    status: "enabled",
    createdAt: now,
    updatedAt: now
  });
  assert.equal(parsed.success, false);
});

test("tool invocation helper always includes schema version and generated id", () => {
  const invocation = createToolInvocationRequest({
    toolId: "tool.local-file-read",
    tenantId: "tenant-local",
    workspaceId: "workspace-local",
    actor: { principalId: "user:alice", principalType: "human_user" },
    caller: { principalId: "service:orchestrator-service", principalType: "service" },
    input: { path: "README.md" },
    requestedSecretRefs: [],
    trace: {
      traceId: "d0fd4e4f-3f72-4316-b694-8f81cb92fadc",
      correlationId: "896e8f76-58e4-48c4-baf0-7265f604cf43"
    }
  });
  assert.equal(invocation.schemaVersion, "1.0");
  assert.match(invocation.invocationId, /^tool-invocation:/);
});
