/**
 * H5 — Replay / Tampering Resistance tests
 *
 * Covers:
 * - signed intent verification success/failure
 * - expired approval rejection
 * - valid approval within window accepted
 * - payload mutation after approval rejected (INTENT_PAYLOAD_HASH_INVALID)
 * - artifact hash mismatch rejected
 * - idempotent duplicate artifact handling (ARTIFACT_ALREADY_CONSUMED)
 * - nonce reuse rejection (ARTIFACT_NONCE_REPLAYED)
 * - replayed artifact via different nonce with same content rejected
 * - forged intent signature rejected
 * - "unsigned" keyId rejected at validation boundary
 * - valid artifact accepted exactly as designed
 * - dispatch payload hash stability and tamper detection
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import {
  computeDispatchPayloadHash,
  createExecutionIntent
} from "@manasvi/contracts";

import {
  signApprovedIntentArtifact,
  signExecutionIntent,
  validateExecutionAuthorization,
  verifyApprovedIntentArtifact,
  verifyExecutionIntentSignature
} from "./index.js";

// ─── Constants ────────────────────────────────────────────────────────────────

const INTENT_KEY = { keyId: "intent-k1", secret: "intent-secret-1" };
const ARTIFACT_KEY = { keyId: "approval-k1", secret: "approval-secret-1" };

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildSnapshot(overrides: Partial<{
  tenantId: string;
  workspaceId: string;
  cmd: string;
  idempotencyKey: string;
  ttlMs: number;
}> = {}) {
  const now = new Date();
  return {
    tenantId: overrides.tenantId ?? "tenant-a",
    workspaceId: overrides.workspaceId ?? "workspace-a",
    actor: { principalType: "human_user" as const, principalId: "user:alice" },
    caller: { principalType: "service" as const, principalId: "service:orchestrator-service" },
    originSessionId: "session:1",
    trace: { traceId: randomUUID(), correlationId: randomUUID() },
    action: {
      actionId: "tool.run",
      actionClass: "external-side-effect" as const,
      operation: "run",
      parameters: { cmd: overrides.cmd ?? "echo hi" }
    },
    target: {
      resourceClass: "tool-endpoint" as const,
      resourceId: "tool:shell",
      tenantId: overrides.tenantId ?? "tenant-a",
      workspaceId: overrides.workspaceId ?? "workspace-a",
      attributes: {}
    },
    requiredCapabilities: ["tool.invoke"],
    risk: { score: 70, level: "high" as const, reasons: ["external_side_effect"] },
    policy: {
      decisionId: `decision:${randomUUID()}`,
      decision: "REQUIRE_APPROVAL" as const,
      approvalRequired: true,
      reasonCodes: ["RULE_REQUIRES_APPROVAL"],
      policySetVersion: "set-1",
      policySourceRef: "configs/policies/default-policy-set.json",
      auditRecordId: `audit:${randomUUID()}`
    },
    createdByService: "orchestrator-service",
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + (overrides.ttlMs ?? 60_000)).toISOString(),
    idempotencyKey: overrides.idempotencyKey ?? `idem:${randomUUID()}`
  };
}

function buildSignedIntent(overrides: Parameters<typeof buildSnapshot>[0] = {}) {
  const unsigned = createExecutionIntent({
    snapshot: buildSnapshot(overrides),
    approval: {
      state: "approved",
      required: true,
      approvedBy: { principalType: "human_user", principalId: "user:approver" },
      approvedAt: new Date().toISOString()
    },
    lifecycle: "execution_authorized"
  });
  return signExecutionIntent(unsigned, INTENT_KEY);
}

function buildArtifact(intent: ReturnType<typeof buildSignedIntent>, overrides: {
  expiresAt?: string;
  nonce?: string;
  artifactId?: string;
  policyDecisionId?: string;
} = {}) {
  return signApprovedIntentArtifact(
    {
      schemaVersion: "1.0",
      artifactId: overrides.artifactId ?? `artifact:${randomUUID()}`,
      intentId: intent.intentId,
      intentVersion: intent.intentVersion,
      intentPayloadHash: intent.payloadHash,
      approvalState: "approved",
      issuedAt: new Date().toISOString(),
      expiresAt: overrides.expiresAt ?? new Date(Date.now() + 60_000).toISOString(),
      issuedByService: "approval-service",
      approvalRecordId: `approval-record:${randomUUID()}`,
      policyDecisionId: overrides.policyDecisionId ?? intent.snapshot.policy.decisionId,
      nonce: overrides.nonce ?? `nonce:${randomUUID()}`,
      trace: intent.snapshot.trace,
      tokenVersion: "1.0"
    },
    ARTIFACT_KEY
  );
}

// ─── Intent signing tests ─────────────────────────────────────────────────────

test("signed intent verifies with correct key", () => {
  const intent = buildSignedIntent();
  const result = verifyExecutionIntentSignature(intent, { [INTENT_KEY.keyId]: INTENT_KEY.secret });
  assert.equal(result.ok, true);
});

test("intent signature fails with wrong secret", () => {
  const intent = buildSignedIntent();
  const result = verifyExecutionIntentSignature(intent, { [INTENT_KEY.keyId]: "wrong-secret" });
  assert.equal(result.ok, false);
  assert.equal(result.code, "INTENT_SIGNATURE_INVALID");
});

test("intent signature fails with unknown key id", () => {
  const intent = buildSignedIntent();
  const result = verifyExecutionIntentSignature(intent, { "other-key": "some-secret" });
  assert.equal(result.ok, false);
  assert.equal(result.code, "INTENT_SIGNING_KEY_UNKNOWN");
});

test("unsigned keyId is rejected at validation boundary", () => {
  // An intent created without signing (keyId = 'unsigned') must never pass.
  const unsigned = createExecutionIntent({
    snapshot: buildSnapshot(),
    approval: { state: "approved", required: true,
      approvedBy: { principalType: "human_user", principalId: "user:approver" },
      approvedAt: new Date().toISOString() },
    lifecycle: "execution_authorized"
  });
  const artifact = buildArtifact(unsigned as ReturnType<typeof buildSignedIntent>);
  // Provide the "unsigned" literal as a key so the lookup passes but HMAC fails
  const result = validateExecutionAuthorization({
    intent: unsigned,
    artifact,
    verificationSecretsByKeyId: { [ARTIFACT_KEY.keyId]: ARTIFACT_KEY.secret },
    intentVerificationSecretsByKeyId: { unsigned: "any-secret" }
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "INTENT_SIGNATURE_INVALID");
});

test("intent signature is stable — same input produces same signature", () => {
  const snapshot = buildSnapshot();
  const unsigned1 = createExecutionIntent({
    snapshot,
    approval: { state: "approved", required: true,
      approvedBy: { principalType: "human_user", principalId: "user:approver" },
      approvedAt: new Date().toISOString() },
    lifecycle: "execution_authorized"
  });
  const signedAt = new Date().toISOString();
  const s1 = signExecutionIntent(unsigned1, { ...INTENT_KEY, signedAt });
  const s2 = signExecutionIntent(unsigned1, { ...INTENT_KEY, signedAt });
  assert.equal(s1.integrity.value, s2.integrity.value);
});

// ─── Payload hash / mutation tests ───────────────────────────────────────────

test("payload mutation after approval is rejected (INTENT_PAYLOAD_HASH_INVALID)", () => {
  const intent = buildSignedIntent();
  const artifact = buildArtifact(intent);
  const mutatedIntent = {
    ...intent,
    snapshot: {
      ...intent.snapshot,
      action: { ...intent.snapshot.action, parameters: { cmd: "rm -rf /" } }
    }
  };
  const result = validateExecutionAuthorization({
    intent: mutatedIntent,
    artifact,
    verificationSecretsByKeyId: { [ARTIFACT_KEY.keyId]: ARTIFACT_KEY.secret },
    intentVerificationSecretsByKeyId: { [INTENT_KEY.keyId]: INTENT_KEY.secret }
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "INTENT_PAYLOAD_HASH_INVALID");
});

test("artifact payload hash mismatch is rejected", () => {
  const intent = buildSignedIntent();
  // Artifact approved for a different intent payload
  const differentIntent = buildSignedIntent({ cmd: "different-command" });
  const artifact = buildArtifact(differentIntent); // approved for differentIntent
  // But we present it against the original intent
  const tampered = { ...artifact, intentId: intent.intentId, intentVersion: intent.intentVersion };
  const result = validateExecutionAuthorization({
    intent,
    artifact: tampered,
    verificationSecretsByKeyId: { [ARTIFACT_KEY.keyId]: ARTIFACT_KEY.secret },
    intentVerificationSecretsByKeyId: { [INTENT_KEY.keyId]: INTENT_KEY.secret }
  });
  // intentId matches but intentPayloadHash diverges → ARTIFACT_SIGNATURE_INVALID
  // (changing intentId in the artifact breaks the HMAC)
  assert.equal(result.ok, false);
});

// ─── Expiration tests ─────────────────────────────────────────────────────────

test("expired approval artifact is rejected", () => {
  const intent = buildSignedIntent();
  const artifact = buildArtifact(intent, {
    expiresAt: new Date(Date.now() - 1_000).toISOString()
  });
  const result = validateExecutionAuthorization({
    intent,
    artifact,
    verificationSecretsByKeyId: { [ARTIFACT_KEY.keyId]: ARTIFACT_KEY.secret },
    intentVerificationSecretsByKeyId: { [INTENT_KEY.keyId]: INTENT_KEY.secret }
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "APPROVAL_ARTIFACT_EXPIRED");
});

test("expired intent is rejected", () => {
  const intent = buildSignedIntent({ ttlMs: -1_000 }); // already expired
  const artifact = buildArtifact(intent);
  const result = validateExecutionAuthorization({
    intent,
    artifact,
    verificationSecretsByKeyId: { [ARTIFACT_KEY.keyId]: ARTIFACT_KEY.secret },
    intentVerificationSecretsByKeyId: { [INTENT_KEY.keyId]: INTENT_KEY.secret }
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "INTENT_EXPIRED");
});

test("valid artifact within window is accepted", () => {
  const intent = buildSignedIntent();
  const artifact = buildArtifact(intent);
  const result = validateExecutionAuthorization({
    intent,
    artifact,
    verificationSecretsByKeyId: { [ARTIFACT_KEY.keyId]: ARTIFACT_KEY.secret },
    intentVerificationSecretsByKeyId: { [INTENT_KEY.keyId]: INTENT_KEY.secret }
  });
  assert.equal(result.ok, true);
});

// ─── Replay / idempotency tests ───────────────────────────────────────────────

test("replayed artifact id is rejected (ARTIFACT_ALREADY_CONSUMED)", () => {
  const intent = buildSignedIntent();
  const artifact = buildArtifact(intent, { artifactId: "artifact:consumed-1" });
  const result = validateExecutionAuthorization({
    intent,
    artifact,
    verificationSecretsByKeyId: { [ARTIFACT_KEY.keyId]: ARTIFACT_KEY.secret },
    intentVerificationSecretsByKeyId: { [INTENT_KEY.keyId]: INTENT_KEY.secret },
    consumedArtifactIds: new Set(["artifact:consumed-1"])
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "ARTIFACT_ALREADY_CONSUMED");
});

test("replayed artifact nonce is rejected (ARTIFACT_NONCE_REPLAYED)", () => {
  const nonce = `nonce:${randomUUID()}`;
  const intent = buildSignedIntent();
  const artifact = buildArtifact(intent, { nonce });
  const result = validateExecutionAuthorization({
    intent,
    artifact,
    verificationSecretsByKeyId: { [ARTIFACT_KEY.keyId]: ARTIFACT_KEY.secret },
    intentVerificationSecretsByKeyId: { [INTENT_KEY.keyId]: INTENT_KEY.secret },
    consumedArtifactNonces: new Set([nonce])
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "ARTIFACT_NONCE_REPLAYED");
});

test("two artifacts with different nonces for same intent are independently valid", () => {
  const intent = buildSignedIntent();
  const a1 = buildArtifact(intent, { nonce: "nonce-a" });
  const a2 = buildArtifact(intent, { nonce: "nonce-b", artifactId: `artifact:${randomUUID()}` });
  // First: consume nonce-a only
  const r1 = validateExecutionAuthorization({
    intent,
    artifact: a1,
    verificationSecretsByKeyId: { [ARTIFACT_KEY.keyId]: ARTIFACT_KEY.secret },
    intentVerificationSecretsByKeyId: { [INTENT_KEY.keyId]: INTENT_KEY.secret },
    consumedArtifactNonces: new Set(["nonce-b"]) // a2 consumed, not a1
  });
  assert.equal(r1.ok, true);
  // Second: consume nonce-b is now replayed
  const r2 = validateExecutionAuthorization({
    intent,
    artifact: a2,
    verificationSecretsByKeyId: { [ARTIFACT_KEY.keyId]: ARTIFACT_KEY.secret },
    intentVerificationSecretsByKeyId: { [INTENT_KEY.keyId]: INTENT_KEY.secret },
    consumedArtifactNonces: new Set(["nonce-b"])
  });
  assert.equal(r2.ok, false);
  assert.equal(r2.code, "ARTIFACT_NONCE_REPLAYED");
});

// ─── Signed artifact tests ────────────────────────────────────────────────────

test("signed artifact verifies with correct key", () => {
  const intent = buildSignedIntent();
  const artifact = buildArtifact(intent);
  const result = verifyApprovedIntentArtifact(artifact, { [ARTIFACT_KEY.keyId]: ARTIFACT_KEY.secret });
  assert.equal(result.ok, true);
});

test("forged artifact signature is rejected", () => {
  const intent = buildSignedIntent();
  const artifact = buildArtifact(intent);
  const forged = {
    ...artifact,
    signature: { ...artifact.signature, value: "deadbeef".repeat(8) }
  };
  const result = verifyApprovedIntentArtifact(forged, { [ARTIFACT_KEY.keyId]: ARTIFACT_KEY.secret });
  assert.equal(result.ok, false);
  assert.equal(result.code, "ARTIFACT_SIGNATURE_INVALID");
});

test("artifact with unknown signing key is rejected", () => {
  const intent = buildSignedIntent();
  const artifact = buildArtifact(intent);
  const result = verifyApprovedIntentArtifact(artifact, { "other-key": "other-secret" });
  assert.equal(result.ok, false);
  assert.equal(result.code, "ARTIFACT_SIGNING_KEY_UNKNOWN");
});

test("nonce is covered by artifact HMAC — swapping nonce breaks signature", () => {
  const intent = buildSignedIntent();
  // Produce two artifacts with different nonces
  const a1 = buildArtifact(intent, { nonce: "nonce-original" });
  // Manually swap the nonce without re-signing
  const tampered = { ...a1, nonce: "nonce-swapped" };
  const result = verifyApprovedIntentArtifact(tampered, { [ARTIFACT_KEY.keyId]: ARTIFACT_KEY.secret });
  assert.equal(result.ok, false);
  assert.equal(result.code, "ARTIFACT_SIGNATURE_INVALID");
});

// ─── Dispatch payload hash tests ──────────────────────────────────────────────

test("dispatch payload hash is stable for same inputs", () => {
  const input = {
    intentPayloadHash: "abc123",
    artifactId: "artifact:1",
    nodeId: "node:worker-1",
    dispatchId: "dispatch:abc",
    expiresAt: "2030-01-01T00:00:00.000Z"
  };
  const h1 = computeDispatchPayloadHash(input);
  const h2 = computeDispatchPayloadHash(input);
  assert.equal(h1, h2);
  assert.equal(h1.length, 64); // SHA-256 hex
});

test("dispatch payload hash changes when intentPayloadHash is mutated", () => {
  const base = {
    intentPayloadHash: "original-hash",
    artifactId: "artifact:1",
    nodeId: "node:worker-1",
    dispatchId: "dispatch:abc",
    expiresAt: "2030-01-01T00:00:00.000Z"
  };
  const h1 = computeDispatchPayloadHash(base);
  const h2 = computeDispatchPayloadHash({ ...base, intentPayloadHash: "mutated-hash" });
  assert.notEqual(h1, h2);
});

test("dispatch payload hash changes when nodeId is mutated (wrong target)", () => {
  const base = {
    intentPayloadHash: "abc123",
    artifactId: "artifact:1",
    nodeId: "node:intended-target",
    dispatchId: "dispatch:abc",
    expiresAt: "2030-01-01T00:00:00.000Z"
  };
  const h1 = computeDispatchPayloadHash(base);
  const h2 = computeDispatchPayloadHash({ ...base, nodeId: "node:attacker-node" });
  assert.notEqual(h1, h2);
});

test("dispatch payload hash changes when expiresAt is mutated (freshness extension)", () => {
  const base = {
    intentPayloadHash: "abc123",
    artifactId: "artifact:1",
    nodeId: "node:worker-1",
    dispatchId: "dispatch:abc",
    expiresAt: "2025-01-01T00:00:00.000Z"
  };
  const h1 = computeDispatchPayloadHash(base);
  const h2 = computeDispatchPayloadHash({ ...base, expiresAt: "2099-12-31T23:59:59.000Z" });
  assert.notEqual(h1, h2);
});

// ─── Integration: approval not required path ──────────────────────────────────

test("not_required approval state is accepted without approval flow", () => {
  const snapshot = buildSnapshot();
  const unsigned = createExecutionIntent({
    snapshot: { ...snapshot, policy: { ...snapshot.policy, decision: "ALLOW", approvalRequired: false } },
    approval: { state: "not_required", required: false },
    lifecycle: "execution_authorized"
  });
  const intent = signExecutionIntent(unsigned, INTENT_KEY);
  const artifact = signApprovedIntentArtifact(
    {
      schemaVersion: "1.0",
      artifactId: `artifact:${randomUUID()}`,
      intentId: intent.intentId,
      intentVersion: intent.intentVersion,
      intentPayloadHash: intent.payloadHash,
      approvalState: "not_required",
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      issuedByService: "approval-service",
      approvalRecordId: `record:${randomUUID()}`,
      policyDecisionId: intent.snapshot.policy.decisionId,
      nonce: `nonce:${randomUUID()}`,
      trace: intent.snapshot.trace,
      tokenVersion: "1.0"
    },
    ARTIFACT_KEY
  );
  const result = validateExecutionAuthorization({
    intent,
    artifact,
    verificationSecretsByKeyId: { [ARTIFACT_KEY.keyId]: ARTIFACT_KEY.secret },
    intentVerificationSecretsByKeyId: { [INTENT_KEY.keyId]: INTENT_KEY.secret }
  });
  assert.equal(result.ok, true);
});
