import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";

import { CONTRACT_SCHEMA_VERSION } from "./base.js";
import { principalReferenceSchema } from "./identity.js";
import {
  actionClassSchema,
  policyDecisionResultSchema,
  policyTraceSchema,
  policyResourceReferenceSchema
} from "./policy.js";

export const EXECUTION_INTENT_CONTRACT_VERSION = "1.0" as const;

export const intentRiskLevelSchema = z.enum(["low", "medium", "high", "critical"]);
export type IntentRiskLevel = z.infer<typeof intentRiskLevelSchema>;

export const intentApprovalStateSchema = z.enum([
  "not_required",
  "pending",
  "approved",
  "rejected",
  "expired",
  "revoked",
  "invalid"
]);
export type IntentApprovalState = z.infer<typeof intentApprovalStateSchema>;

export const executionIntentLifecycleStateSchema = z.enum([
  "created",
  "denied",
  "pending_approval",
  "approved",
  "rejected",
  "expired",
  "revoked",
  "execution_authorized",
  "execution_started",
  "execution_completed",
  "execution_failed",
  "invalid"
]);
export type ExecutionIntentLifecycleState = z.infer<typeof executionIntentLifecycleStateSchema>;

export const executionIntentSnapshotSchema = z.object({
  tenantId: z.string().min(1),
  workspaceId: z.string().min(1),
  actor: principalReferenceSchema,
  caller: principalReferenceSchema,
  originSessionId: z.string().min(1).optional(),
  trace: policyTraceSchema,
  action: z.object({
    actionId: z.string().min(1),
    actionClass: actionClassSchema,
    toolRef: z.string().min(1).optional(),
    operation: z.string().min(1),
    parameters: z.record(z.unknown()).default({})
  }),
  target: policyResourceReferenceSchema,
  requiredCapabilities: z.array(z.string().min(1)).default([]),
  risk: z.object({
    score: z.number().int().min(0).max(100),
    level: intentRiskLevelSchema,
    reasons: z.array(z.string().min(1)).default([])
  }),
  policy: z.object({
    decisionId: z.string().min(1),
    decision: policyDecisionResultSchema,
    approvalRequired: z.boolean(),
    reasonCodes: z.array(z.string().min(1)),
    policySetVersion: z.string().min(1),
    policySourceRef: z.string().min(1),
    matchedPolicyId: z.string().min(1).optional(),
    matchedRuleId: z.string().min(1).optional(),
    auditRecordId: z.string().min(1)
  }),
  createdByService: z.string().min(1),
  createdAt: z.string().datetime({ offset: true }),
  expiresAt: z.string().datetime({ offset: true }),
  idempotencyKey: z.string().min(1)
});
export type ExecutionIntentSnapshot = z.infer<typeof executionIntentSnapshotSchema>;

export const executionIntentSchema = z.object({
  schemaVersion: z.literal(EXECUTION_INTENT_CONTRACT_VERSION),
  contractVersion: z.literal(CONTRACT_SCHEMA_VERSION),
  intentId: z.string().min(1),
  intentVersion: z.literal("1.0"),
  snapshot: executionIntentSnapshotSchema,
  payloadHash: z.string().min(1),
  approval: z.object({
    state: intentApprovalStateSchema,
    required: z.boolean(),
    requirementReason: z.string().min(1).optional(),
    approvalRequestId: z.string().min(1).optional(),
    approvedBy: principalReferenceSchema.optional(),
    approvedAt: z.string().datetime({ offset: true }).optional()
  }),
  lifecycle: executionIntentLifecycleStateSchema,
  updatedAt: z.string().datetime({ offset: true }),
  parentIntentId: z.string().min(1).optional(),
  causationId: z.string().min(1).optional()
});
export type ExecutionIntent = z.infer<typeof executionIntentSchema>;

export const approvalDecisionInputSchema = z.object({
  decision: z.enum(["approved", "rejected"]),
  decidedBy: principalReferenceSchema,
  decidedAt: z.string().datetime({ offset: true }),
  reason: z.string().min(1).optional(),
  trace: policyTraceSchema
});
export type ApprovalDecisionInput = z.infer<typeof approvalDecisionInputSchema>;

export const approvalRequestSchema = z.object({
  schemaVersion: z.literal(EXECUTION_INTENT_CONTRACT_VERSION),
  approvalRequestId: z.string().min(1),
  intentId: z.string().min(1),
  tenantId: z.string().min(1),
  workspaceId: z.string().min(1),
  actor: principalReferenceSchema,
  target: policyResourceReferenceSchema,
  actionClass: actionClassSchema,
  requestedCapabilities: z.array(z.string().min(1)),
  risk: z.object({
    score: z.number().int().min(0).max(100),
    level: intentRiskLevelSchema
  }),
  summary: z.string().min(1),
  policyReason: z.string().min(1),
  state: z.enum(["pending", "approved", "rejected", "expired", "revoked", "invalid"]),
  createdAt: z.string().datetime({ offset: true }),
  expiresAt: z.string().datetime({ offset: true }),
  trace: policyTraceSchema,
  intentPayloadHash: z.string().min(1)
});
export type ApprovalRequest = z.infer<typeof approvalRequestSchema>;

export const approvedIntentArtifactSchema = z.object({
  schemaVersion: z.literal(EXECUTION_INTENT_CONTRACT_VERSION),
  artifactId: z.string().min(1),
  intentId: z.string().min(1),
  intentVersion: z.literal("1.0"),
  intentPayloadHash: z.string().min(1),
  approvalState: z.enum(["approved", "not_required"]),
  issuedAt: z.string().datetime({ offset: true }),
  expiresAt: z.string().datetime({ offset: true }),
  issuedByService: z.string().min(1),
  approvalRequestId: z.string().min(1).optional(),
  approvalRecordId: z.string().min(1),
  policyDecisionId: z.string().min(1),
  trace: policyTraceSchema,
  signature: z.object({
    algorithm: z.literal("hmac-sha256"),
    keyId: z.string().min(1),
    value: z.string().min(1)
  }),
  tokenVersion: z.literal("1.0")
});
export type ApprovedIntentArtifact = z.infer<typeof approvedIntentArtifactSchema>;

export const approvalRecordSchema = z.object({
  schemaVersion: z.literal(EXECUTION_INTENT_CONTRACT_VERSION),
  approvalRecordId: z.string().min(1),
  intentId: z.string().min(1),
  intentPayloadHash: z.string().min(1),
  approvalRequestId: z.string().min(1).optional(),
  decision: z.enum(["approved", "rejected", "expired", "revoked"]),
  decidedBy: principalReferenceSchema,
  decidedAt: z.string().datetime({ offset: true }),
  reason: z.string().min(1).optional(),
  policyDecisionId: z.string().min(1),
  policyAuditRecordId: z.string().min(1),
  riskLevel: intentRiskLevelSchema,
  actionClass: actionClassSchema,
  targetResourceClass: policyResourceReferenceSchema.shape.resourceClass,
  targetResourceId: z.string().min(1),
  trace: policyTraceSchema,
  recordedByService: z.string().min(1),
  recordedAt: z.string().datetime({ offset: true })
});
export type ApprovalRecord = z.infer<typeof approvalRecordSchema>;

export function stableStringify(input: unknown): string {
  if (input === null || typeof input !== "object") {
    return JSON.stringify(input);
  }
  if (Array.isArray(input)) {
    return `[${input.map((item) => stableStringify(item)).join(",")}]`;
  }
  const object = input as Record<string, unknown>;
  const keys = Object.keys(object).sort();
  const parts = keys.map((key) => `${JSON.stringify(key)}:${stableStringify(object[key])}`);
  return `{${parts.join(",")}}`;
}

export function computeExecutionIntentPayloadHash(snapshot: ExecutionIntentSnapshot): string {
  return createHash("sha256").update(stableStringify(snapshot), "utf8").digest("hex");
}

export function createExecutionIntent(input: {
  snapshot: ExecutionIntentSnapshot;
  approval: ExecutionIntent["approval"];
  lifecycle: ExecutionIntentLifecycleState;
  parentIntentId?: string;
  causationId?: string;
}): ExecutionIntent {
  const now = new Date().toISOString();
  return executionIntentSchema.parse({
    schemaVersion: EXECUTION_INTENT_CONTRACT_VERSION,
    contractVersion: CONTRACT_SCHEMA_VERSION,
    intentId: `intent:${randomUUID()}`,
    intentVersion: "1.0",
    snapshot: executionIntentSnapshotSchema.parse(input.snapshot),
    payloadHash: computeExecutionIntentPayloadHash(input.snapshot),
    approval: input.approval,
    lifecycle: input.lifecycle,
    updatedAt: now,
    ...(input.parentIntentId ? { parentIntentId: input.parentIntentId } : {}),
    ...(input.causationId ? { causationId: input.causationId } : {})
  });
}
