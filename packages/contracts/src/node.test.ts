import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";

import {
  createNodePairingGrant,
  nodeDispatchRequestSchema,
  nodeIdentitySchema,
  nodePairingRequestSchema
} from "./node.js";

test("node identity schema accepts explicit trust/state metadata", () => {
  const now = new Date().toISOString();
  const parsed = nodeIdentitySchema.parse({
    schemaVersion: "1.0",
    contractVersion: "1.0.0",
    nodeId: "node:test-1",
    principal: {
      principalId: "node:node:test-1",
      principalType: "execution_node"
    },
    nodeClass: "restricted_utility_node",
    status: "active",
    tenantId: "tenant-local",
    workspaceId: "workspace-local",
    attestation: {
      attestationId: "att:1",
      recordedAt: now,
      source: "node-agent",
      verificationStatus: "verified",
      verificationConfidence: "high",
      runtimeVersion: "node-agent/1.0.0",
      os: "linux",
      arch: "x64",
      environmentClass: "remote",
      sandboxSupport: ["no_network_compute"],
      networkZone: "zone-a",
      filesystemProfileHint: "read_only",
      capabilityClaims: ["node.execute"],
      notes: []
    },
    capabilities: [],
    createdAt: now,
    updatedAt: now,
    labels: []
  });
  assert.equal(parsed.nodeClass, "restricted_utility_node");
});

test("pairing request schema validates required enrollment fields", () => {
  const now = new Date().toISOString();
  const trace = { traceId: randomUUID(), correlationId: randomUUID() };
  const parsed = nodePairingRequestSchema.parse({
    schemaVersion: "1.0",
    requestId: "pair:req:1",
    nodeId: "node:test-2",
    nodeClass: "trusted_personal_node",
    tenantId: "tenant-local",
    workspaceId: "workspace-local",
    attestation: {
      attestationId: "att:2",
      recordedAt: now,
      source: "node-agent",
      verificationStatus: "unverified",
      verificationConfidence: "medium",
      runtimeVersion: "node-agent/1.0.0",
      os: "darwin",
      arch: "arm64",
      environmentClass: "personal",
      sandboxSupport: ["read_only_local"],
      networkZone: "home-lan",
      filesystemProfileHint: "bounded",
      capabilityClaims: [],
      notes: []
    },
    requestedCapabilities: [],
    trace
  });
  assert.equal(parsed.nodeId, "node:test-2");
});

test("dispatch request schema carries scoped execution artifacts", () => {
  const now = new Date().toISOString();
  const trace = { traceId: randomUUID(), correlationId: randomUUID() };
  const parsed = nodeDispatchRequestSchema.parse({
    schemaVersion: "1.0",
    dispatchId: "dispatch:1",
    nodeId: "node:test-3",
    executionIntent: {
      schemaVersion: "1.0",
      contractVersion: "1.0.0",
      intentId: "intent:1",
      intentVersion: "1.0",
      snapshot: {
        tenantId: "tenant-local",
        workspaceId: "workspace-local",
        actor: { principalId: "user:alice", principalType: "human_user" },
        caller: { principalId: "service:orchestrator-service", principalType: "service" },
        trace,
        action: { actionId: "tool.invoke", actionClass: "execute", operation: "run", parameters: {} },
        target: { resourceClass: "execution-node", resourceId: "node:test-3", attributes: {} },
        requiredCapabilities: [],
        risk: { score: 30, level: "medium", reasons: [] },
        policy: {
          decisionId: "decision:1",
          decision: "ALLOW",
          approvalRequired: false,
          reasonCodes: ["ALLOW_BY_POLICY"],
          policySetVersion: "test",
          policySourceRef: "test",
          auditRecordId: "audit:1"
        },
        createdByService: "orchestrator-service",
        createdAt: now,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        idempotencyKey: "idem:1"
      },
      payloadHash: "hash",
      approval: { state: "not_required", required: false },
      lifecycle: "execution_authorized",
      updatedAt: now
    },
    approvedArtifact: {
      schemaVersion: "1.0",
      artifactId: "artifact:1",
      intentId: "intent:1",
      intentVersion: "1.0",
      intentPayloadHash: "hash",
      approvalState: "not_required",
      issuedAt: now,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      issuedByService: "approval-service",
      approvalRecordId: "approval-record:1",
      policyDecisionId: "decision:1",
      trace,
      signature: {
        algorithm: "hmac-sha256",
        keyId: "k1",
        value: "sig"
      },
      tokenVersion: "1.0"
    },
    toolContract: {
      schemaVersion: "1.0",
      contractId: "tool-contract:1",
      invocation: {
        schemaVersion: "1.0",
        invocationId: "inv:1",
        toolId: "tool.local-file-read",
        tenantId: "tenant-local",
        workspaceId: "workspace-local",
        actor: { principalId: "user:alice", principalType: "human_user" },
        caller: { principalId: "service:orchestrator-service", principalType: "service" },
        input: {},
        requestedSecretRefs: [],
        trace
      },
      manifest: {
        schemaVersion: "1.0",
        contractVersion: "1.0.0",
        toolId: "tool.local-file-read",
        name: "Local File Read Tool",
        version: "1.0.0",
        description: "d",
        owner: "owner",
        provider: "provider",
        type: "built_in",
        actionClass: "read",
        sideEffectClass: "read_only",
        mutability: "read_only",
        capabilities: [
          {
            capabilityId: "filesystem.read",
            required: true,
            scope: { tenantScoped: true, workspaceScoped: true, resourceClass: "filesystem-zone" },
            constraints: {}
          }
        ],
        resourceClassesTouched: ["filesystem-zone"],
        inputSchema: { type: "object", properties: {} },
        outputSchema: { type: "object", properties: {} },
        runtimeHints: {
          defaultTimeoutMs: 5000,
          defaultSandboxMode: "read_only_local",
          egressProfiles: [],
          filesystemProfile: "read_only_inputs",
          declaredSecretRefs: [],
          requireExecutorPath: true,
          approvalSensitive: false
        },
        runtimeBinding: { toolRef: "tool:file-read", operation: "file_read" },
        policyBinding: {
          policyActionClass: "read",
          resource: { resourceClass: "filesystem-zone", resourceId: "filesystem:workspace" },
          requiresExplicitPolicy: true,
          approvalHint: "none"
        },
        trustNotes: [],
        tags: [],
        status: "enabled",
        createdAt: now,
        updatedAt: now
      },
      intent: {
        schemaVersion: "1.0",
        contractVersion: "1.0.0",
        intentId: "intent:1",
        intentVersion: "1.0",
        snapshot: {
          tenantId: "tenant-local",
          workspaceId: "workspace-local",
          actor: { principalId: "user:alice", principalType: "human_user" },
          caller: { principalId: "service:orchestrator-service", principalType: "service" },
          trace,
          action: { actionId: "tool.invoke", actionClass: "execute", operation: "run", parameters: {} },
          target: { resourceClass: "execution-node", resourceId: "node:test-3", attributes: {} },
          requiredCapabilities: [],
          risk: { score: 30, level: "medium", reasons: [] },
          policy: {
            decisionId: "decision:1",
            decision: "ALLOW",
            approvalRequired: false,
            reasonCodes: ["ALLOW_BY_POLICY"],
            policySetVersion: "test",
            policySourceRef: "test",
            auditRecordId: "audit:1"
          },
          createdByService: "orchestrator-service",
          createdAt: now,
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          idempotencyKey: "idem:1"
        },
        payloadHash: "hash",
        approval: { state: "not_required", required: false },
        lifecycle: "execution_authorized",
        updatedAt: now
      },
      artifact: {
        schemaVersion: "1.0",
        artifactId: "artifact:1",
        intentId: "intent:1",
        intentVersion: "1.0",
        intentPayloadHash: "hash",
        approvalState: "not_required",
        issuedAt: now,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        issuedByService: "approval-service",
        approvalRecordId: "approval-record:1",
        policyDecisionId: "decision:1",
        trace,
        signature: {
          algorithm: "hmac-sha256",
          keyId: "k1",
          value: "sig"
        },
        tokenVersion: "1.0"
      },
      trace
    },
    runtimePolicy: {
      schemaVersion: "1.0",
      policyId: "runtime:1",
      sandboxMode: "restricted_remote",
      timeoutMs: 10000,
      cpuTimeLimitSeconds: 10,
      memoryLimitMb: 256,
      filesystem: { mode: "read_only_inputs", readPaths: ["/tmp"], writePaths: [] },
      network: { mode: "allowlist_only", egressAllowlist: [] },
      secrets: { allowedSecretRefs: [], injectedSecretEnvNames: [] },
      cleanup: { removeWorkspaceAfterRun: true },
      derivedFrom: { actionClass: "execute", target: { resourceClass: "execution-node", resourceId: "node:test-3", attributes: {} } }
    },
    scopedExecutionToken: "token",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    policyDecisionId: "decision:1",
    trace,
    metadata: {}
  });
  assert.equal(parsed.nodeId, "node:test-3");
});

test("createNodePairingGrant generates pairing identifier", () => {
  const trace = { traceId: randomUUID(), correlationId: randomUUID() };
  const grant = createNodePairingGrant({
    nodeId: "node:test-4",
    status: "pending",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    trace
  });
  assert.match(grant.pairingId, /^pairing:/);
});
