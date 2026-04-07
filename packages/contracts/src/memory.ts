import { randomUUID } from "node:crypto";
import { z } from "zod";

import { CONTRACT_SCHEMA_VERSION, trustClassSchema } from "./base.js";
import { principalReferenceSchema } from "./identity.js";
import { policyTraceSchema } from "./policy.js";

export const MEMORY_PLANE_CONTRACT_VERSION = "1.0" as const;

export const memoryClassSchema = z.enum([
  "EPHEMERAL_SESSION",
  "USER_DURABLE",
  "ORG_SHARED_TRUSTED",
  "UNTRUSTED_EXTERNAL",
  "AUDIT_ACTION_HISTORY"
]);
export type MemoryClass = z.infer<typeof memoryClassSchema>;

export const memorySourceTypeSchema = z.enum([
  "session-message",
  "user-input",
  "uploaded-document",
  "retrieved-web-content",
  "tool-result",
  "model-summary",
  "approved-note",
  "audit-event-reference",
  "shared-curation"
]);
export type MemorySourceType = z.infer<typeof memorySourceTypeSchema>;

export const memoryPromotionStatusSchema = z.enum([
  "not_applicable",
  "candidate",
  "pending_review",
  "approved",
  "rejected",
  "promoted"
]);
export type MemoryPromotionStatus = z.infer<typeof memoryPromotionStatusSchema>;

export const memoryRetentionPolicySchema = z.object({
  ttlSeconds: z.number().int().positive().optional(),
  expiresAt: z.string().datetime({ offset: true }).optional(),
  retentionClass: z.enum(["short_lived", "durable", "bounded_cache", "audit_aligned"]),
  deleteAfterExpiry: z.boolean().default(true)
});
export type MemoryRetentionPolicy = z.infer<typeof memoryRetentionPolicySchema>;

export const memoryEncryptionMetadataSchema = z.object({
  encryptedAtRest: z.boolean(),
  algorithm: z.string().min(1).optional(),
  keyRef: z.string().min(1).optional(),
  encryptedAt: z.string().datetime({ offset: true }).optional()
});
export type MemoryEncryptionMetadata = z.infer<typeof memoryEncryptionMetadataSchema>;

export const memoryProvenanceSchema = z.object({
  sourceType: memorySourceTypeSchema,
  sourceId: z.string().min(1),
  sourceRef: z.string().min(1),
  originatingPrincipal: principalReferenceSchema.optional(),
  originatingService: z.string().min(1).optional(),
  originalMemoryClass: memoryClassSchema.optional(),
  originalTrustClassification: trustClassSchema.optional(),
  createdAt: z.string().datetime({ offset: true }),
  linkedSessionId: z.string().min(1).optional(),
  linkedMessageId: z.string().min(1).optional(),
  linkedToolRunId: z.string().min(1).optional(),
  linkedAuditRecordId: z.string().min(1).optional(),
  linkedExternalRef: z.string().min(1).optional(),
  derivation: z.object({
    derived: z.boolean().default(false),
    derivationType: z.string().min(1).optional(),
    derivedFromRecordIds: z.array(z.string().min(1)).default([]),
    derivedFromSourceRefs: z.array(z.string().min(1)).default([])
  }).default({
    derived: false,
    derivedFromRecordIds: [],
    derivedFromSourceRefs: []
  })
});
export type MemoryProvenance = z.infer<typeof memoryProvenanceSchema>;

export const memoryRecordSchema = z.object({
  schemaVersion: z.literal(MEMORY_PLANE_CONTRACT_VERSION),
  contractVersion: z.literal(CONTRACT_SCHEMA_VERSION),
  recordId: z.string().min(1),
  memoryClass: memoryClassSchema,
  namespace: z.string().min(1),
  tenantId: z.string().min(1),
  workspaceId: z.string().min(1),
  ownerPrincipal: principalReferenceSchema.optional(),
  subjectPrincipal: principalReferenceSchema.optional(),
  trustClassification: trustClassSchema,
  contentType: z.enum(["text/plain", "application/json", "reference"]),
  content: z.object({
    text: z.string().optional(),
    data: z.record(z.unknown()).default({})
  }),
  tags: z.array(z.string().min(1)).default([]),
  provenance: memoryProvenanceSchema,
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
  createdByPrincipal: principalReferenceSchema,
  createdByService: z.string().min(1),
  retention: memoryRetentionPolicySchema,
  encryption: memoryEncryptionMetadataSchema,
  promotion: z.object({
    status: memoryPromotionStatusSchema,
    sourceRecordId: z.string().min(1).optional(),
    targetRecordId: z.string().min(1).optional(),
    reviewId: z.string().min(1).optional()
  }),
  sourceReferences: z.array(z.string().min(1)).default([]),
  auditLinkage: z.object({
    auditRecordId: z.string().min(1).optional(),
    executionRunId: z.string().min(1).optional(),
    approvalRecordId: z.string().min(1).optional()
  }).default({})
});
export type MemoryRecord = z.infer<typeof memoryRecordSchema>;

export const memoryWriteRequestSchema = z.object({
  schemaVersion: z.literal(MEMORY_PLANE_CONTRACT_VERSION),
  memoryClass: memoryClassSchema,
  namespace: z.string().min(1),
  tenantId: z.string().min(1),
  workspaceId: z.string().min(1),
  ownerPrincipal: principalReferenceSchema.optional(),
  subjectPrincipal: principalReferenceSchema.optional(),
  trustClassification: trustClassSchema,
  contentType: z.enum(["text/plain", "application/json", "reference"]),
  content: z.object({
    text: z.string().optional(),
    data: z.record(z.unknown()).default({})
  }),
  tags: z.array(z.string().min(1)).default([]),
  provenance: memoryProvenanceSchema,
  sourceReferences: z.array(z.string().min(1)).default([]),
  retentionOverrideTtlSeconds: z.number().int().positive().optional(),
  trace: policyTraceSchema
});
export type MemoryWriteRequest = z.infer<typeof memoryWriteRequestSchema>;

export const memoryQueryRequestSchema = z.object({
  schemaVersion: z.literal(MEMORY_PLANE_CONTRACT_VERSION),
  tenantId: z.string().min(1),
  workspaceId: z.string().min(1),
  classes: z.array(memoryClassSchema).optional(),
  namespaces: z.array(z.string().min(1)).optional(),
  ownerPrincipalId: z.string().min(1).optional(),
  subjectPrincipalId: z.string().min(1).optional(),
  trustClassFilter: z.array(trustClassSchema).optional(),
  includeExpired: z.boolean().default(false),
  limit: z.number().int().positive().max(200).default(20),
  trace: policyTraceSchema
});
export type MemoryQueryRequest = z.infer<typeof memoryQueryRequestSchema>;

export const memoryQueryResponseSchema = z.object({
  schemaVersion: z.literal(MEMORY_PLANE_CONTRACT_VERSION),
  records: z.array(memoryRecordSchema),
  trace: policyTraceSchema
});
export type MemoryQueryResponse = z.infer<typeof memoryQueryResponseSchema>;

export const memoryPromotionCandidateRequestSchema = z.object({
  schemaVersion: z.literal(MEMORY_PLANE_CONTRACT_VERSION),
  recordId: z.string().min(1),
  targetClass: memoryClassSchema,
  targetNamespace: z.string().min(1),
  reason: z.string().min(1),
  trace: policyTraceSchema
});
export type MemoryPromotionCandidateRequest = z.infer<typeof memoryPromotionCandidateRequestSchema>;

export const memoryPromotionReviewSchema = z.object({
  schemaVersion: z.literal(MEMORY_PLANE_CONTRACT_VERSION),
  reviewId: z.string().min(1),
  sourceRecordId: z.string().min(1),
  targetClass: memoryClassSchema,
  targetNamespace: z.string().min(1),
  status: z.enum(["pending", "approved", "rejected"]),
  requestedBy: principalReferenceSchema,
  requestedAt: z.string().datetime({ offset: true }),
  reviewedBy: principalReferenceSchema.optional(),
  reviewedAt: z.string().datetime({ offset: true }).optional(),
  decisionReason: z.string().min(1).optional(),
  trace: policyTraceSchema
});
export type MemoryPromotionReview = z.infer<typeof memoryPromotionReviewSchema>;

export const memoryContextRecordSchema = z.object({
  recordId: z.string().min(1),
  memoryClass: memoryClassSchema,
  namespace: z.string().min(1),
  trustClassification: trustClassSchema,
  contentType: z.enum(["text/plain", "application/json", "reference"]),
  content: z.object({
    text: z.string().optional(),
    data: z.record(z.unknown()).default({})
  }),
  provenance: memoryProvenanceSchema,
  sourceRef: z.string().min(1)
});
export type MemoryContextRecord = z.infer<typeof memoryContextRecordSchema>;

export const memoryContextCandidatesRequestSchema = z.object({
  schemaVersion: z.literal(MEMORY_PLANE_CONTRACT_VERSION),
  tenantId: z.string().min(1),
  workspaceId: z.string().min(1),
  actorPrincipal: principalReferenceSchema,
  callerPrincipal: principalReferenceSchema,
  sessionId: z.string().min(1).optional(),
  queryText: z.string().min(1).optional(),
  maxPerClass: z.number().int().positive().max(20).default(5),
  trace: policyTraceSchema
});
export type MemoryContextCandidatesRequest = z.infer<typeof memoryContextCandidatesRequestSchema>;

export const memoryContextCandidatesResponseSchema = z.object({
  schemaVersion: z.literal(MEMORY_PLANE_CONTRACT_VERSION),
  records: z.array(memoryContextRecordSchema),
  trace: policyTraceSchema
});
export type MemoryContextCandidatesResponse = z.infer<typeof memoryContextCandidatesResponseSchema>;

export const memoryAuditEventSchema = z.object({
  schemaVersion: z.literal(MEMORY_PLANE_CONTRACT_VERSION),
  eventId: z.string().min(1),
  eventType: z.enum([
    "memory.created",
    "memory.read",
    "memory.queried",
    "memory.expired",
    "memory.promotion_candidate_created",
    "memory.promotion_approved",
    "memory.promotion_rejected",
    "memory.access_denied"
  ]),
  recordId: z.string().min(1).optional(),
  namespace: z.string().min(1),
  memoryClass: memoryClassSchema.optional(),
  actor: principalReferenceSchema,
  caller: principalReferenceSchema,
  tenantId: z.string().min(1),
  workspaceId: z.string().min(1),
  policyDecisionId: z.string().min(1).optional(),
  timestamp: z.string().datetime({ offset: true }),
  trace: policyTraceSchema,
  metadata: z.record(z.unknown()).default({})
});
export type MemoryAuditEvent = z.infer<typeof memoryAuditEventSchema>;

export function createMemoryRecordId(): string {
  return `memory:${randomUUID()}`;
}

export function createMemoryReviewId(): string {
  return `memory-review:${randomUUID()}`;
}
