import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { createExecutionIntent } from "@manasvi/contracts";

import {
  signApprovedIntentArtifact,
  validateExecutionAuthorization,
  verifyApprovedIntentArtifact
} from "./index.js";

function buildIntent() {
  const now = new Date();
  return createExecutionIntent({
    snapshot: {
      tenantId: "tenant-a",
      workspaceId: "workspace-a",
      actor: { principalType: "human_user", principalId: "user:alice" },
      caller: { principalType: "service", principalId: "service:orchestrator-service" },
      originSessionId: "session:1",
      trace: { traceId: randomUUID(), correlationId: randomUUID() },
      action: {
        actionId: "tool.run",
        actionClass: "external-side-effect",
        operation: "run",
        parameters: { cmd: "echo hi" }
      },
      target: {
        resourceClass: "tool-endpoint",
        resourceId: "tool:shell",
        tenantId: "tenant-a",
        workspaceId: "workspace-a",
        attributes: {}
      },
      requiredCapabilities: ["tool.invoke"],
      risk: { score: 70, level: "high", reasons: ["external_side_effect"] },
      policy: {
        decisionId: "decision:1",
        decision: "REQUIRE_APPROVAL",
        approvalRequired: true,
        reasonCodes: ["RULE_REQUIRES_APPROVAL"],
        policySetVersion: "set-1",
        policySourceRef: "configs/policies/default-policy-set.json",
        auditRecordId: "audit:1"
      },
      createdByService: "orchestrator-service",
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 60_000).toISOString(),
      idempotencyKey: "idem-1"
    },
    approval: {
      state: "approved",
      required: true,
      approvedBy: { principalType: "human_user", principalId: "user:approver" },
      approvedAt: now.toISOString()
    },
    lifecycle: "execution_authorized"
  });
}

test("signed artifact verifies with correct key", () => {
  const intent = buildIntent();
  const artifact = signApprovedIntentArtifact(
    {
      schemaVersion: "1.0",
      artifactId: "artifact:1",
      intentId: intent.intentId,
      intentVersion: intent.intentVersion,
      intentPayloadHash: intent.payloadHash,
      approvalState: "approved",
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      issuedByService: "approval-service",
      approvalRecordId: "approval-record:1",
      policyDecisionId: intent.snapshot.policy.decisionId,
      trace: intent.snapshot.trace,
      tokenVersion: "1.0"
    },
    { keyId: "local-k1", secret: "approval-secret" }
  );
  const result = verifyApprovedIntentArtifact(artifact, { "local-k1": "approval-secret" });
  assert.equal(result.ok, true);
});

test("validation fails when payload mutates after approval", () => {
  const intent = buildIntent();
  const artifact = signApprovedIntentArtifact(
    {
      schemaVersion: "1.0",
      artifactId: "artifact:2",
      intentId: intent.intentId,
      intentVersion: intent.intentVersion,
      intentPayloadHash: intent.payloadHash,
      approvalState: "approved",
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      issuedByService: "approval-service",
      approvalRecordId: "approval-record:2",
      policyDecisionId: intent.snapshot.policy.decisionId,
      trace: intent.snapshot.trace,
      tokenVersion: "1.0"
    },
    { keyId: "local-k1", secret: "approval-secret" }
  );
  const mutatedIntent = {
    ...intent,
    snapshot: {
      ...intent.snapshot,
      action: {
        ...intent.snapshot.action,
        parameters: { cmd: "rm -rf /" }
      }
    }
  };
  const result = validateExecutionAuthorization({
    intent: mutatedIntent,
    artifact,
    verificationSecretsByKeyId: { "local-k1": "approval-secret" }
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "INTENT_PAYLOAD_HASH_INVALID");
});

test("validation fails for expired artifact", () => {
  const intent = buildIntent();
  const artifact = signApprovedIntentArtifact(
    {
      schemaVersion: "1.0",
      artifactId: "artifact:3",
      intentId: intent.intentId,
      intentVersion: intent.intentVersion,
      intentPayloadHash: intent.payloadHash,
      approvalState: "approved",
      issuedAt: new Date(Date.now() - 120_000).toISOString(),
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
      issuedByService: "approval-service",
      approvalRecordId: "approval-record:3",
      policyDecisionId: intent.snapshot.policy.decisionId,
      trace: intent.snapshot.trace,
      tokenVersion: "1.0"
    },
    { keyId: "local-k1", secret: "approval-secret" }
  );
  const result = validateExecutionAuthorization({
    intent,
    artifact,
    verificationSecretsByKeyId: { "local-k1": "approval-secret" }
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "APPROVAL_ARTIFACT_EXPIRED");
});

test("validation rejects replayed artifact id", () => {
  const intent = buildIntent();
  const artifact = signApprovedIntentArtifact(
    {
      schemaVersion: "1.0",
      artifactId: "artifact:4",
      intentId: intent.intentId,
      intentVersion: intent.intentVersion,
      intentPayloadHash: intent.payloadHash,
      approvalState: "approved",
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      issuedByService: "approval-service",
      approvalRecordId: "approval-record:4",
      policyDecisionId: intent.snapshot.policy.decisionId,
      trace: intent.snapshot.trace,
      tokenVersion: "1.0"
    },
    { keyId: "local-k1", secret: "approval-secret" }
  );
  const result = validateExecutionAuthorization({
    intent,
    artifact,
    verificationSecretsByKeyId: { "local-k1": "approval-secret" },
    consumedArtifactIds: new Set(["artifact:4"])
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "ARTIFACT_ALREADY_CONSUMED");
});

test("validation rejects intent requiring approval when not approved", () => {
  const intent = {
    ...buildIntent(),
    approval: {
      state: "pending" as const,
      required: true
    },
    lifecycle: "pending_approval" as const
  };
  const artifact = signApprovedIntentArtifact(
    {
      schemaVersion: "1.0",
      artifactId: "artifact:5",
      intentId: intent.intentId,
      intentVersion: intent.intentVersion,
      intentPayloadHash: intent.payloadHash,
      approvalState: "approved",
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      issuedByService: "approval-service",
      approvalRecordId: "approval-record:5",
      policyDecisionId: intent.snapshot.policy.decisionId,
      trace: intent.snapshot.trace,
      tokenVersion: "1.0"
    },
    { keyId: "local-k1", secret: "approval-secret" }
  );
  const result = validateExecutionAuthorization({
    intent,
    artifact,
    verificationSecretsByKeyId: { "local-k1": "approval-secret" }
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "INTENT_APPROVAL_NOT_GRANTED");
});
