import { randomUUID } from "node:crypto";
import { z } from "zod";

import { CONTRACT_SCHEMA_VERSION, trustClassSchema } from "./base.js";
import { principalReferenceSchema } from "./identity.js";

export const SESSION_CONTEXT_CONTRACT_VERSION = "1.0" as const;

export const sessionStatusSchema = z.enum(["active", "idle", "closed", "expired"]);
export type SessionStatus = z.infer<typeof sessionStatusSchema>;

export const sessionTypeSchema = z.enum([
  "user_interaction",
  "agent_workflow",
  "channel_thread",
  "service_internal"
]);
export type SessionType = z.infer<typeof sessionTypeSchema>;

export const sessionIsolationModeSchema = z.enum([
  "per_user_isolated",
  "per_channel_thread",
  "shared_collaborative",
  "ephemeral_one_shot",
  "service_internal",
  "workspace_scoped_constrained"
]);
export type SessionIsolationMode = z.infer<typeof sessionIsolationModeSchema>;

export const sessionRiskProfileSchema = z.object({
  level: z.enum(["low", "medium", "high", "critical"]).default("low"),
  factors: z.array(z.string().min(1)).default([]),
  unsafeRequestCount: z.number().int().nonnegative().default(0),
  untrustedContentRatio: z.number().min(0).max(1).default(0),
  secretWorkflow: z.boolean().default(false),
  privilegedExecution: z.boolean().default(false),
  pluginInvolved: z.boolean().default(false),
  remoteNodeInvolved: z.boolean().default(false),
  approvalSensitive: z.boolean().default(false)
});
export type SessionRiskProfile = z.infer<typeof sessionRiskProfileSchema>;

export const sessionContextParticipantSchema = z.object({
  principal: principalReferenceSchema,
  role: z.string().min(1).optional(),
  joinedAt: z.string().datetime({ offset: true })
});
export type SessionContextParticipant = z.infer<typeof sessionContextParticipantSchema>;

export const sessionEntitySchema = z.object({
  schemaVersion: z.literal(SESSION_CONTEXT_CONTRACT_VERSION),
  contractVersion: z.literal(CONTRACT_SCHEMA_VERSION),
  sessionId: z.string().min(1),
  sessionType: sessionTypeSchema,
  isolationMode: sessionIsolationModeSchema,
  status: sessionStatusSchema.default("active"),
  tenantId: z.string().min(1),
  workspaceId: z.string().min(1),
  owner: principalReferenceSchema,
  createdBy: principalReferenceSchema,
  lastActedBy: principalReferenceSchema.optional(),
  participants: z.array(sessionContextParticipantSchema).default([]),
  channelBinding: z
    .object({
      channelPrincipal: principalReferenceSchema,
      externalThreadId: z.string().min(1).optional(),
      externalConversationId: z.string().min(1).optional()
    })
    .optional(),
  contextPolicyHints: z.record(z.unknown()).default({}),
  tags: z.array(z.string().min(1)).default([]),
  createdAt: z.string().datetime({ offset: true }),
  lastActivityAt: z.string().datetime({ offset: true }),
  expiresAt: z.string().datetime({ offset: true }).optional(),
  ttlSeconds: z.number().int().positive().optional(),
  riskProfile: sessionRiskProfileSchema
});
export type SessionEntity = z.infer<typeof sessionEntitySchema>;

export const sessionMessageSchema = z.object({
  messageId: z.string().min(1),
  sessionId: z.string().min(1),
  tenantId: z.string().min(1),
  workspaceId: z.string().min(1),
  sender: principalReferenceSchema,
  text: z.string().min(1),
  createdAt: z.string().datetime({ offset: true }),
  trustClassification: trustClassSchema,
  sourceRef: z.string().min(1)
});
export type SessionMessage = z.infer<typeof sessionMessageSchema>;

export const contextSourceTypeSchema = z.enum([
  "session-message",
  "system-instruction",
  "retrieved-web-content",
  "tool-result",
  "user-memory",
  "shared-memory",
  "untrusted-external-upload",
  "policy-note",
  "model-generated-summary",
  "session-metadata",
  "risk-annotation",
  "channel-metadata"
]);
export type ContextSourceType = z.infer<typeof contextSourceTypeSchema>;

export const contextContentCategorySchema = z.enum([
  "instruction",
  "user-input",
  "assistant-output",
  "memory-fact",
  "retrieval-snippet",
  "tool-output",
  "policy-annotation",
  "risk-annotation",
  "metadata"
]);
export type ContextContentCategory = z.infer<typeof contextContentCategorySchema>;

export const contextProvenanceSchema = z.object({
  sourceType: contextSourceTypeSchema,
  sourceId: z.string().min(1),
  sourceRef: z.string().min(1),
  originatingPrincipal: principalReferenceSchema.optional(),
  originatingService: z.string().min(1).optional(),
  observedAt: z.string().datetime({ offset: true }),
  trustClassification: trustClassSchema,
  tenantId: z.string().min(1).optional(),
  workspaceId: z.string().min(1).optional(),
  sessionId: z.string().min(1).optional(),
  contentCategory: contextContentCategorySchema,
  transformation: z
    .object({
      transformed: z.boolean().default(false),
      transformType: z.string().min(1).optional(),
      derivedFromChunkIds: z.array(z.string().min(1)).default([]),
      derivedFromSourceRefs: z.array(z.string().min(1)).default([])
    })
    .default({
      transformed: false,
      derivedFromChunkIds: [],
      derivedFromSourceRefs: []
    })
});
export type ContextProvenance = z.infer<typeof contextProvenanceSchema>;

export const contextChunkSchema = z.object({
  chunkId: z.string().min(1),
  sessionId: z.string().min(1),
  tenantId: z.string().min(1),
  workspaceId: z.string().min(1),
  content: z.string().min(1),
  tokenEstimate: z.number().int().positive().default(1),
  createdAt: z.string().datetime({ offset: true }),
  expiresAt: z.string().datetime({ offset: true }).optional(),
  sticky: z.boolean().default(false),
  stale: z.boolean().default(false),
  provenance: contextProvenanceSchema,
  metadata: z.record(z.unknown()).default({})
});
export type ContextChunk = z.infer<typeof contextChunkSchema>;

export const contextTraceOutcomeSchema = z.enum(["included", "excluded", "transformed"]);
export type ContextTraceOutcome = z.infer<typeof contextTraceOutcomeSchema>;

export const contextTraceReasonCodeSchema = z.enum([
  "INCLUDED_RECENT_SESSION_MESSAGE",
  "INCLUDED_SYSTEM_INSTRUCTION",
  "INCLUDED_METADATA",
  "INCLUDED_TOOL_RESULT",
  "INCLUDED_POLICY_NOTE",
  "EXCLUDED_TTL_EXPIRED",
  "EXCLUDED_STALE",
  "EXCLUDED_CROSS_SESSION",
  "EXCLUDED_CROSS_TENANT",
  "EXCLUDED_CROSS_WORKSPACE",
  "EXCLUDED_ISOLATION_MODE",
  "EXCLUDED_TOKEN_BUDGET",
  "EXCLUDED_LOW_PRIORITY",
  "EXCLUDED_RISK_POLICY",
  "TRANSFORMED_SUMMARY"
]);
export type ContextTraceReasonCode = z.infer<typeof contextTraceReasonCodeSchema>;

export const contextTraceEntrySchema = z.object({
  chunkId: z.string().min(1),
  sourceRef: z.string().min(1),
  sourceType: contextSourceTypeSchema,
  trustClassification: trustClassSchema,
  outcome: contextTraceOutcomeSchema,
  reasonCode: contextTraceReasonCodeSchema,
  detail: z.string().optional()
});
export type ContextTraceEntry = z.infer<typeof contextTraceEntrySchema>;

export const messageContextTraceSchema = z.object({
  traceId: z.string().min(1),
  messageId: z.string().min(1),
  sessionId: z.string().min(1),
  tenantId: z.string().min(1),
  workspaceId: z.string().min(1),
  resolvedBy: z.string().min(1),
  resolvedAt: z.string().datetime({ offset: true }),
  isolationMode: sessionIsolationModeSchema,
  riskProfile: sessionRiskProfileSchema,
  consideredSources: z.array(contextSourceTypeSchema),
  entries: z.array(contextTraceEntrySchema),
  includedChunkIds: z.array(z.string().min(1)),
  excludedChunkIds: z.array(z.string().min(1)),
  tokenBudget: z.number().int().positive(),
  tokenUsed: z.number().int().nonnegative(),
  trace: z.object({
    traceId: z.string().uuid(),
    correlationId: z.string().uuid(),
    parentTraceId: z.string().uuid().optional()
  })
});
export type MessageContextTrace = z.infer<typeof messageContextTraceSchema>;

export const assembledContextSchema = z.object({
  session: sessionEntitySchema,
  chunks: z.array(contextChunkSchema),
  trace: messageContextTraceSchema
});
export type AssembledContext = z.infer<typeof assembledContextSchema>;

export function createSessionId(prefix = "session"): string {
  return `${prefix}:${randomUUID()}`;
}

export function createContextTraceId(prefix = "ctx-trace"): string {
  return `${prefix}:${randomUUID()}`;
}
