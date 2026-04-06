import { createHmac, randomUUID } from "node:crypto";

import {
  approvedIntentArtifactSchema,
  approvalRecordSchema,
  computeExecutionIntentPayloadHash,
  executionIntentSchema,
  type ApprovalRecord,
  type ApprovedIntentArtifact,
  type ExecutionIntent,
  type IntentRiskLevel
} from "@manasvi/contracts";

export type ExecutionRisk = IntentRiskLevel;

export interface IntentValidationResult {
  ok: boolean;
  code?: string;
  message?: string;
}

function artifactSigningPayload(input: {
  intentId: string;
  intentPayloadHash: string;
  expiresAt: string;
  approvalState: "approved" | "not_required";
  policyDecisionId: string;
  tokenVersion: string;
}): string {
  return [
    input.intentId,
    input.intentPayloadHash,
    input.expiresAt,
    input.approvalState,
    input.policyDecisionId,
    input.tokenVersion
  ].join("|");
}

export function signApprovedIntentArtifact(
  artifactWithoutSignature: Omit<ApprovedIntentArtifact, "signature">,
  signing: { keyId: string; secret: string }
): ApprovedIntentArtifact {
  const payload = artifactSigningPayload({
    intentId: artifactWithoutSignature.intentId,
    intentPayloadHash: artifactWithoutSignature.intentPayloadHash,
    expiresAt: artifactWithoutSignature.expiresAt,
    approvalState: artifactWithoutSignature.approvalState,
    policyDecisionId: artifactWithoutSignature.policyDecisionId,
    tokenVersion: artifactWithoutSignature.tokenVersion
  });
  const signature = createHmac("sha256", signing.secret).update(payload, "utf8").digest("hex");
  return approvedIntentArtifactSchema.parse({
    ...artifactWithoutSignature,
    signature: {
      algorithm: "hmac-sha256",
      keyId: signing.keyId,
      value: signature
    }
  });
}

export function verifyApprovedIntentArtifact(
  artifact: ApprovedIntentArtifact,
  verificationSecretsByKeyId: Record<string, string>
): IntentValidationResult {
  const parsed = approvedIntentArtifactSchema.safeParse(artifact);
  if (!parsed.success) {
    return {
      ok: false,
      code: "ARTIFACT_SCHEMA_INVALID",
      message: parsed.error.issues.map((issue) => `${issue.path.join(".")}:${issue.message}`).join("; ")
    };
  }
  const keyId = artifact.signature.keyId;
  const secret = verificationSecretsByKeyId[keyId];
  if (!secret) {
    return { ok: false, code: "ARTIFACT_SIGNING_KEY_UNKNOWN", message: `Unknown signing key id ${keyId}` };
  }
  const payload = artifactSigningPayload({
    intentId: artifact.intentId,
    intentPayloadHash: artifact.intentPayloadHash,
    expiresAt: artifact.expiresAt,
    approvalState: artifact.approvalState,
    policyDecisionId: artifact.policyDecisionId,
    tokenVersion: artifact.tokenVersion
  });
  const expected = createHmac("sha256", secret).update(payload, "utf8").digest("hex");
  if (expected !== artifact.signature.value) {
    return { ok: false, code: "ARTIFACT_SIGNATURE_INVALID", message: "Artifact signature verification failed" };
  }
  return { ok: true };
}

export function validateExecutionAuthorization(input: {
  intent: unknown;
  artifact: unknown;
  verificationSecretsByKeyId: Record<string, string>;
  now?: Date;
  consumedArtifactIds?: Set<string>;
}): IntentValidationResult {
  const parsedIntent = executionIntentSchema.safeParse(input.intent);
  if (!parsedIntent.success) {
    return {
      ok: false,
      code: "INTENT_SCHEMA_INVALID",
      message: parsedIntent.error.issues.map((issue) => `${issue.path.join(".")}:${issue.message}`).join("; ")
    };
  }
  const intent = parsedIntent.data;

  const parsedArtifact = approvedIntentArtifactSchema.safeParse(input.artifact);
  if (!parsedArtifact.success) {
    return {
      ok: false,
      code: "ARTIFACT_SCHEMA_INVALID",
      message: parsedArtifact.error.issues.map((issue) => `${issue.path.join(".")}:${issue.message}`).join("; ")
    };
  }
  const artifact = parsedArtifact.data;

  if (artifact.intentId !== intent.intentId) {
    return { ok: false, code: "INTENT_ARTIFACT_MISMATCH", message: "Artifact intentId does not match intent" };
  }
  if (artifact.intentVersion !== intent.intentVersion) {
    return { ok: false, code: "INTENT_VERSION_MISMATCH", message: "Artifact intent version does not match" };
  }

  const computedPayloadHash = computeExecutionIntentPayloadHash(intent.snapshot);
  if (intent.payloadHash !== computedPayloadHash) {
    return { ok: false, code: "INTENT_PAYLOAD_HASH_INVALID", message: "Intent payload hash does not match snapshot" };
  }
  if (artifact.intentPayloadHash !== intent.payloadHash) {
    return {
      ok: false,
      code: "ARTIFACT_PAYLOAD_HASH_MISMATCH",
      message: "Artifact payload hash does not match intent payload hash"
    };
  }

  const signatureVerification = verifyApprovedIntentArtifact(artifact, input.verificationSecretsByKeyId);
  if (!signatureVerification.ok) {
    return signatureVerification;
  }

  const now = input.now ?? new Date();
  if (new Date(intent.snapshot.expiresAt).getTime() <= now.getTime()) {
    return { ok: false, code: "INTENT_EXPIRED", message: "Intent is expired" };
  }
  if (new Date(artifact.expiresAt).getTime() <= now.getTime()) {
    return { ok: false, code: "APPROVAL_ARTIFACT_EXPIRED", message: "Approval artifact is expired" };
  }

  if (input.consumedArtifactIds?.has(artifact.artifactId)) {
    return { ok: false, code: "ARTIFACT_ALREADY_CONSUMED", message: "Approval artifact already consumed" };
  }

  if (intent.lifecycle === "denied" || intent.lifecycle === "rejected" || intent.lifecycle === "invalid") {
    return { ok: false, code: "INTENT_NOT_EXECUTABLE_STATE", message: `Intent lifecycle ${intent.lifecycle} is not executable` };
  }
  if (intent.approval.required && intent.approval.state !== "approved") {
    return { ok: false, code: "INTENT_APPROVAL_NOT_GRANTED", message: "Intent requires approval but is not approved" };
  }
  if (artifact.approvalState === "approved" && intent.approval.state !== "approved") {
    return { ok: false, code: "APPROVAL_STATE_MISMATCH", message: "Artifact approved state does not match intent approval state" };
  }
  return { ok: true };
}

export function createApprovalRecord(input: {
  intent: ExecutionIntent;
  decision: "approved" | "rejected" | "expired" | "revoked";
  decidedBy: ExecutionIntent["snapshot"]["actor"];
  decidedAt: string;
  policyDecisionId: string;
  policyAuditRecordId: string;
  recordedByService: string;
  reason?: string;
}): ApprovalRecord {
  return approvalRecordSchema.parse({
    schemaVersion: "1.0",
    approvalRecordId: `approval-record:${randomUUID()}`,
    intentId: input.intent.intentId,
    intentPayloadHash: input.intent.payloadHash,
    ...(input.intent.approval.approvalRequestId ? { approvalRequestId: input.intent.approval.approvalRequestId } : {}),
    decision: input.decision,
    decidedBy: input.decidedBy,
    decidedAt: input.decidedAt,
    ...(input.reason ? { reason: input.reason } : {}),
    policyDecisionId: input.policyDecisionId,
    policyAuditRecordId: input.policyAuditRecordId,
    riskLevel: input.intent.snapshot.risk.level,
    actionClass: input.intent.snapshot.action.actionClass,
    targetResourceClass: input.intent.snapshot.target.resourceClass,
    targetResourceId: input.intent.snapshot.target.resourceId,
    trace: input.intent.snapshot.trace,
    recordedByService: input.recordedByService,
    recordedAt: new Date().toISOString()
  });
}
