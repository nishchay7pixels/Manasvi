import assert from "node:assert/strict";
import test from "node:test";

import { createExecutionIntent, type EgressWhitelistPolicy, type PolicyEvaluationResponse } from "@manasvi/contracts";
import { signApprovedIntentArtifact } from "@manasvi/executor-sdk";

import { deriveRuntimePolicy } from "./runtime-policy.js";

function buildDecision(overrides?: Partial<PolicyEvaluationResponse>): PolicyEvaluationResponse {
  return {
    schemaVersion: "1.0",
    decisionId: "decision:test",
    decision: "ALLOW",
    reasonCodes: ["ALLOW_BY_POLICY"],
    approvalRequired: false,
    conditions: [],
    risk: {
      score: 35,
      level: "medium",
      factors: []
    },
    policySetVersion: "test",
    policySourceRef: "test",
    ttlSeconds: 300,
    auditRecordId: "audit:test",
    trace: {
      traceId: "2d429916-7c17-4652-b93e-dba6108e5e26",
      correlationId: "563de3e5-6f09-45fd-b208-cdb6638c2fbd"
    },
    ...overrides
  };
}

const egressPolicy: EgressWhitelistPolicy = {
  schemaVersion: "1.0",
  policyId: "egress:test",
  description: "test allowlist",
  rules: [{ hostPattern: "api.local", protocol: "https", port: 443 }]
};

test("deriveRuntimePolicy selects restricted_remote for network action", () => {
  const intent = createExecutionIntent({
    snapshot: {
      tenantId: "tenant-local",
      workspaceId: "workspace-local",
      actor: { principalId: "user:alice", principalType: "human_user" },
      caller: { principalId: "service:orchestrator-service", principalType: "service" },
      trace: {
        traceId: "ce0cdc42-f9fc-45ff-b890-84345c8caa5b",
        correlationId: "97e4f7e6-d35a-4419-b913-c88d5f440fcb"
      },
      action: {
        actionId: "intent.network.get",
        actionClass: "access-network",
        toolRef: "tool:http-get",
        operation: "http_get",
        parameters: {}
      },
      target: {
        resourceClass: "network-zone",
        resourceId: "internet:allowlisted",
        tenantId: "tenant-local",
        workspaceId: "workspace-local",
        attributes: {}
      },
      requiredCapabilities: [],
      risk: {
        score: 60,
        level: "high",
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
    approval: {
      state: "not_required",
      required: false
    },
    lifecycle: "execution_authorized"
  });

  const artifact = signApprovedIntentArtifact(
    {
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
      trace: intent.snapshot.trace,
      tokenVersion: "1.0"
    },
    { keyId: "local-k1", secret: "local-dev-secret" }
  );

  const policy = deriveRuntimePolicy({
    intent,
    artifact,
    policyDecision: buildDecision(),
    sandboxProfileDefault: "read_only",
    egressWhitelistPolicy: egressPolicy
  });

  assert.equal(policy.sandboxMode, "restricted_remote");
  assert.equal(policy.network.mode, "allowlist_only");
  assert.equal(policy.network.egressAllowlist.length, 1);
});

test("deriveRuntimePolicy exposes secret refs only when requested", () => {
  const intent = createExecutionIntent({
    snapshot: {
      tenantId: "tenant-local",
      workspaceId: "workspace-local",
      actor: { principalId: "user:alice", principalType: "human_user" },
      caller: { principalId: "service:orchestrator-service", principalType: "service" },
      trace: {
        traceId: "1fd5ef01-fa2f-4ef0-a75f-80b2fee4c130",
        correlationId: "852c96ef-04a9-4295-a728-8b2437c3a038"
      },
      action: {
        actionId: "intent.secret.read",
        actionClass: "access-secret",
        toolRef: "tool:env-dump",
        operation: "env_dump",
        parameters: {}
      },
      target: {
        resourceClass: "secret-reference",
        resourceId: "secret:demo",
        tenantId: "tenant-local",
        workspaceId: "workspace-local",
        attributes: {}
      },
      requiredCapabilities: ["secret:secret:demo"],
      risk: {
        score: 65,
        level: "high",
        reasons: []
      },
      policy: {
        decisionId: "decision:test",
        decision: "ALLOW",
        approvalRequired: true,
        reasonCodes: ["REQUIRES_APPROVAL"],
        policySetVersion: "test",
        policySourceRef: "test",
        auditRecordId: "audit:test"
      },
      createdByService: "orchestrator-service",
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      idempotencyKey: "idempotency:test"
    },
    approval: {
      state: "approved",
      required: true,
      approvalRequestId: "approval-request:test"
    },
    lifecycle: "approved"
  });

  const artifact = signApprovedIntentArtifact(
    {
      schemaVersion: "1.0",
      artifactId: "artifact:test",
      intentId: intent.intentId,
      intentVersion: "1.0",
      intentPayloadHash: intent.payloadHash,
      approvalState: "approved",
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      issuedByService: "approval-service",
      approvalRecordId: "approval-record:test",
      policyDecisionId: "decision:test",
      trace: intent.snapshot.trace,
      tokenVersion: "1.0",
      approvalRequestId: "approval-request:test"
    },
    { keyId: "local-k1", secret: "local-dev-secret" }
  );

  const policy = deriveRuntimePolicy({
    intent,
    artifact,
    policyDecision: buildDecision({ approvalRequired: true }),
    sandboxProfileDefault: "mutation_limited",
    egressWhitelistPolicy: egressPolicy
  });

  assert.equal(policy.sandboxMode, "no_network_compute");
  assert.ok(policy.secrets.allowedSecretRefs.includes("secret:demo"));
});

test("deriveRuntimePolicy escalates to privileged mode for critical risk", () => {
  const intent = createExecutionIntent({
    snapshot: {
      tenantId: "tenant-local",
      workspaceId: "workspace-local",
      actor: { principalId: "user:alice", principalType: "human_user" },
      caller: { principalId: "service:orchestrator-service", principalType: "service" },
      trace: {
        traceId: "38751e9f-82fb-4d5f-9afb-6ccf491a4ab8",
        correlationId: "48f9486f-4e79-441a-8c26-4757f7482d71"
      },
      action: {
        actionId: "intent.destructive",
        actionClass: "destructive-action",
        toolRef: "tool:echo",
        operation: "noop",
        parameters: {}
      },
      target: {
        resourceClass: "filesystem-zone",
        resourceId: "fs:critical",
        tenantId: "tenant-local",
        workspaceId: "workspace-local",
        attributes: {}
      },
      requiredCapabilities: [],
      risk: {
        score: 95,
        level: "critical",
        reasons: []
      },
      policy: {
        decisionId: "decision:test",
        decision: "ALLOW",
        approvalRequired: true,
        reasonCodes: ["HIGH_RISK_EXPLICIT_POLICY_REQUIRED"],
        policySetVersion: "test",
        policySourceRef: "test",
        auditRecordId: "audit:test"
      },
      createdByService: "orchestrator-service",
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      idempotencyKey: "idempotency:test"
    },
    approval: {
      state: "approved",
      required: true,
      approvalRequestId: "approval-request:test"
    },
    lifecycle: "approved"
  });

  const artifact = signApprovedIntentArtifact(
    {
      schemaVersion: "1.0",
      artifactId: "artifact:test",
      intentId: intent.intentId,
      intentVersion: "1.0",
      intentPayloadHash: intent.payloadHash,
      approvalState: "approved",
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      issuedByService: "approval-service",
      approvalRecordId: "approval-record:test",
      policyDecisionId: "decision:test",
      trace: intent.snapshot.trace,
      tokenVersion: "1.0",
      approvalRequestId: "approval-request:test"
    },
    { keyId: "local-k1", secret: "local-dev-secret" }
  );

  const policy = deriveRuntimePolicy({
    intent,
    artifact,
    policyDecision: buildDecision({ risk: { score: 95, level: "critical", factors: [] } }),
    sandboxProfileDefault: "read_only",
    egressWhitelistPolicy: egressPolicy
  });

  assert.equal(policy.sandboxMode, "privileged_operator_approved");
  assert.equal(policy.network.mode, "operator_approved");
});
