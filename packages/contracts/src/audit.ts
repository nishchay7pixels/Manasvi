/**
 * Audit event contracts for Manasvi's governance and observability layer.
 *
 * Distinctions preserved:
 * - audit event       : append-only governance record
 * - decision record   : structured governance decision (policy/approval)
 * - trace event       : runtime span linked into distributed trace chain
 * - action timeline   : ordered human-readable view of a workflow
 * - anomaly signal    : hook payload for downstream anomaly detection
 */

import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";

import { CONTRACT_SCHEMA_VERSION, serviceNameSchema, trustClassSchema } from "./base.js";
import { principalReferenceSchema } from "./identity.js";
import { policyTraceSchema } from "./policy.js";

export const AUDIT_CONTRACT_VERSION = "1.0" as const;

// ─── Audit event types ────────────────────────────────────────────────────────

export const auditEventTypeSchema = z.enum([
  // Ingress plane
  "ingress.message.received",
  "ingress.auth.verified",
  "ingress.auth.failed",
  "ingress.rate_limited",
  "ingress.duplicate_rejected",

  // Identity / principal
  "identity.principal.resolved",
  "identity.principal.resolution_failed",
  "identity.token.issued",
  "identity.token.verified",
  "identity.token.expired",
  "identity.token.invalid",

  // Session
  "session.created",
  "session.resolved",
  "session.context.assembled",
  "session.ended",

  // Policy
  "policy.decision.allow",
  "policy.decision.deny",
  "policy.decision.require_approval",
  "policy.decision.conditional_allow",
  "policy.set.loaded",

  // Approval
  "approval.requested",
  "approval.granted",
  "approval.denied",
  "approval.expired",
  "approval.revoked",

  // Execution intent
  "intent.created",
  "intent.validated",
  "intent.rejected",

  // Execution
  "execution.started",
  "execution.completed",
  "execution.failed",
  "execution.timeout",
  "execution.quota_exceeded",
  "execution.sandbox_violation",

  // Tool
  "tool.registered",
  "tool.invoked",
  "tool.completed",
  "tool.failed",
  "tool.policy_denied",

  // Memory
  "memory.read",
  "memory.written",
  "memory.promoted",
  "memory.access_denied",
  "memory.pruned",
  "memory.trust_escalated",

  // Plugin / Extension
  "plugin.registered",
  "plugin.approved",
  "plugin.denied",
  "plugin.started",
  "plugin.stopped",
  "plugin.invoked",
  "plugin.revoked",
  "plugin.handshake_succeeded",
  "plugin.handshake_failed",
  "plugin.capability_denied",

  // Node / Remote
  "node.paired",
  "node.heartbeat",
  "node.dispatched",
  "node.dispatch_completed",
  "node.dispatch_failed",
  "node.quarantined",
  "node.revoked",

  // Audit/System
  "audit.stream.initialized",
  "audit.event.append_failed",
  "audit.integrity.mismatch",

  // Anomaly signals
  "anomaly.policy_denial_spike",
  "anomaly.repeated_auth_failure",
  "anomaly.suspicious_source",
  "anomaly.plugin_handshake_anomaly",
  "anomaly.unusual_secret_access",
  "anomaly.cross_tenant_access_attempt",
  "anomaly.repeated_execution_failure",
  "anomaly.approval_bypass_attempt"
]);
export type AuditEventType = z.infer<typeof auditEventTypeSchema>;

// ─── Severity ─────────────────────────────────────────────────────────────────

export const auditSeveritySchema = z.enum(["info", "warn", "high", "critical"]);
export type AuditSeverity = z.infer<typeof auditSeveritySchema>;

// ─── Decision outcome ─────────────────────────────────────────────────────────

export const decisionOutcomeSchema = z.enum([
  "allow",
  "deny",
  "require_approval",
  "conditional_allow",
  "pending",
  "approved",
  "denied",
  "expired",
  "revoked"
]);
export type DecisionOutcome = z.infer<typeof decisionOutcomeSchema>;

// ─── Resource reference ───────────────────────────────────────────────────────

export const auditResourceRefSchema = z.object({
  resourceClass: z.string().min(1),
  resourceId: z.string().min(1),
  resourceVersion: z.string().min(1).optional(),
  tenantId: z.string().min(1).optional(),
  workspaceId: z.string().min(1).optional()
});
export type AuditResourceRef = z.infer<typeof auditResourceRefSchema>;

// ─── Redaction metadata ───────────────────────────────────────────────────────

export const redactionMetadataSchema = z.object({
  applied: z.boolean().default(false),
  redactedFields: z.array(z.string().min(1)).default([]),
  reason: z.string().min(1).optional()
});
export type RedactionMetadata = z.infer<typeof redactionMetadataSchema>;

// ─── Integrity metadata ───────────────────────────────────────────────────────

export const auditIntegrityMetadataSchema = z.object({
  /**
   * SHA-256 of the canonical event content (excluding integrityHash itself).
   * Computed at ingest time and cannot be modified post-append.
   */
  contentHash: z.string().min(1),
  /**
   * Hash of the previous event in the stream for chaining.
   * First event uses the zero hash "0".repeat(64).
   * Enables detection of record removal or insertion.
   */
  previousEventHash: z.string().min(1),
  /**
   * Monotonically increasing sequence number within the stream.
   */
  sequenceNumber: z.number().int().nonnegative(),
  /**
   * Optional HMAC signature over integrity metadata for tamper-evident verification.
   */
  signature: z.string().min(1).optional()
});
export type AuditIntegrityMetadata = z.infer<typeof auditIntegrityMetadataSchema>;

// ─── Core audit event ─────────────────────────────────────────────────────────

export const auditEventSchema = z.object({
  schemaVersion: z.literal(AUDIT_CONTRACT_VERSION),
  contractVersion: z.literal(CONTRACT_SCHEMA_VERSION),
  auditId: z.string().min(1),
  eventType: auditEventTypeSchema,
  timestamp: z.string().datetime({ offset: true }),
  producingService: serviceNameSchema,

  // Trace linkage
  traceId: z.string().min(1),
  correlationId: z.string().min(1),
  parentTraceId: z.string().min(1).optional(),
  spanId: z.string().min(1).optional(),

  // Principal context
  actor: principalReferenceSchema.optional(),
  caller: principalReferenceSchema.optional(),

  // Scope
  tenantId: z.string().min(1).optional(),
  workspaceId: z.string().min(1).optional(),
  sessionId: z.string().min(1).optional(),

  // Linked resources
  intentId: z.string().min(1).optional(),
  approvalId: z.string().min(1).optional(),
  executionRunId: z.string().min(1).optional(),
  nodeId: z.string().min(1).optional(),
  pluginId: z.string().min(1).optional(),
  toolId: z.string().min(1).optional(),
  memoryNamespace: z.string().min(1).optional(),
  resource: auditResourceRefSchema.optional(),

  // Risk / trust
  severity: auditSeveritySchema,
  trustClassification: trustClassSchema.optional(),

  // Decision outcome (for decision events)
  decisionOutcome: decisionOutcomeSchema.optional(),
  reasonCodes: z.array(z.string().min(1)).default([]),

  // Redaction
  redaction: redactionMetadataSchema,

  // Integrity (added by the audit service at ingest, not by producers)
  integrity: auditIntegrityMetadataSchema.optional(),

  // Structured payload
  payload: z.record(z.unknown()).default({})
});
export type AuditEvent = z.infer<typeof auditEventSchema>;

// ─── Decision record ──────────────────────────────────────────────────────────

/**
 * A decision record is a structured governance record for a specific decision.
 * More structured than a generic audit event — used for policy/approval decisions.
 */
export const decisionRecordSchema = z.object({
  schemaVersion: z.literal(AUDIT_CONTRACT_VERSION),
  decisionId: z.string().min(1),
  auditId: z.string().min(1),
  decisionType: z.enum(["policy", "approval", "capability", "identity", "trust_promotion"]),
  timestamp: z.string().datetime({ offset: true }),
  producingService: serviceNameSchema,
  trace: policyTraceSchema,

  actor: principalReferenceSchema.optional(),
  caller: principalReferenceSchema.optional(),
  tenantId: z.string().min(1).optional(),
  workspaceId: z.string().min(1).optional(),
  sessionId: z.string().min(1).optional(),

  // What was being decided
  actionClass: z.string().min(1),
  resourceClass: z.string().min(1),
  resourceId: z.string().min(1),

  outcome: decisionOutcomeSchema,
  reasonCodes: z.array(z.string().min(1)).default([]),
  matchedPolicyId: z.string().min(1).optional(),
  matchedRuleId: z.string().min(1).optional(),
  approvalRequired: z.boolean().default(false),

  riskLevel: z.enum(["low", "medium", "high", "critical"]).optional(),
  riskScore: z.number().min(0).max(100).optional(),

  linkedIntentId: z.string().min(1).optional(),
  linkedApprovalId: z.string().min(1).optional(),
  linkedExecutionId: z.string().min(1).optional()
});
export type DecisionRecord = z.infer<typeof decisionRecordSchema>;

// ─── Approval record ──────────────────────────────────────────────────────────

export const auditApprovalRecordSchema = z.object({
  schemaVersion: z.literal(AUDIT_CONTRACT_VERSION),
  approvalRecordId: z.string().min(1),
  approvalId: z.string().min(1),
  linkedIntentId: z.string().min(1),
  timestamp: z.string().datetime({ offset: true }),
  producingService: serviceNameSchema,
  trace: policyTraceSchema,
  state: z.enum(["requested", "pending", "granted", "denied", "expired", "revoked"]),
  actor: principalReferenceSchema.optional(),
  caller: principalReferenceSchema.optional(),
  approver: principalReferenceSchema.optional(),
  sessionId: z.string().min(1).optional(),
  tenantId: z.string().min(1).optional(),
  workspaceId: z.string().min(1).optional(),
  payloadHash: z.string().min(1).optional(),
  approvedArtifactId: z.string().min(1).optional(),
  reasonCodes: z.array(z.string().min(1)).default([]),
  context: z.record(z.unknown()).default({})
});
export type AuditApprovalRecord = z.infer<typeof auditApprovalRecordSchema>;

// ─── Tool execution record ────────────────────────────────────────────────────

export const toolExecutionRecordSchema = z.object({
  schemaVersion: z.literal(AUDIT_CONTRACT_VERSION),
  executionRecordId: z.string().min(1),
  timestamp: z.string().datetime({ offset: true }),
  producingService: serviceNameSchema,
  trace: policyTraceSchema,
  runId: z.string().min(1),
  intentId: z.string().min(1).optional(),
  approvalId: z.string().min(1).optional(),
  toolId: z.string().min(1),
  toolVersion: z.string().min(1).optional(),
  nodeId: z.string().min(1).optional(),
  sandboxMode: z.string().min(1),
  runtimePolicySummary: z.record(z.unknown()).default({}),
  startedAt: z.string().datetime({ offset: true }).optional(),
  endedAt: z.string().datetime({ offset: true }).optional(),
  durationMs: z.number().int().nonnegative().optional(),
  status: z.enum(["started", "completed", "failed", "timed_out", "quota_exceeded", "validation_failed"]),
  errorCode: z.string().min(1).optional(),
  actor: principalReferenceSchema.optional(),
  caller: principalReferenceSchema.optional(),
  sessionId: z.string().min(1).optional(),
  tenantId: z.string().min(1).optional(),
  workspaceId: z.string().min(1).optional(),
  resultArtifactId: z.string().min(1).optional()
});
export type ToolExecutionRecord = z.infer<typeof toolExecutionRecordSchema>;

// ─── Trace span ───────────────────────────────────────────────────────────────

/**
 * A trace span represents one service-level step in a distributed trace chain.
 * Linked via traceId / parentSpanId for reconstruction.
 */
export const traceSpanSchema = z.object({
  spanId: z.string().min(1),
  traceId: z.string().min(1),
  parentSpanId: z.string().min(1).optional(),
  service: serviceNameSchema,
  operation: z.string().min(1),
  startedAt: z.string().datetime({ offset: true }),
  endedAt: z.string().datetime({ offset: true }).optional(),
  durationMs: z.number().int().nonnegative().optional(),
  status: z.enum(["ok", "error", "timeout", "cancelled"]),
  linkedAuditIds: z.array(z.string().min(1)).default([]),
  attributes: z.record(z.unknown()).default({})
});
export type TraceSpan = z.infer<typeof traceSpanSchema>;

// ─── Action timeline item ─────────────────────────────────────────────────────

/**
 * A human-readable entry in an action timeline.
 * Built by the audit service from raw audit events.
 */
export const timelineItemSchema = z.object({
  auditId: z.string().min(1),
  sequenceNumber: z.number().int().nonnegative(),
  timestamp: z.string().datetime({ offset: true }),
  eventType: auditEventTypeSchema,
  service: serviceNameSchema,
  summary: z.string().min(1),
  severity: auditSeveritySchema,
  decisionOutcome: decisionOutcomeSchema.optional(),
  traceId: z.string().min(1),
  correlationId: z.string().min(1),
  sessionId: z.string().min(1).optional(),
  intentId: z.string().min(1).optional(),
  actor: principalReferenceSchema.optional(),
  redacted: z.boolean().default(false)
});
export type TimelineItem = z.infer<typeof timelineItemSchema>;

// ─── Anomaly signal ───────────────────────────────────────────────────────────

export const anomalySignalSchema = z.object({
  signalId: z.string().min(1),
  eventType: auditEventTypeSchema,
  traceId: z.string().min(1),
  detectedAt: z.string().datetime({ offset: true }),
  description: z.string().min(1),
  severity: auditSeveritySchema,
  affectedPrincipalId: z.string().min(1).optional(),
  affectedResourceId: z.string().min(1).optional(),
  triggeringAuditIds: z.array(z.string().min(1)).default([]),
  context: z.record(z.unknown()).default({})
});
export type AnomalySignal = z.infer<typeof anomalySignalSchema>;

// ─── Risk summary ─────────────────────────────────────────────────────────────

export const riskSummarySchema = z.object({
  windowStart: z.string().datetime({ offset: true }),
  windowEnd: z.string().datetime({ offset: true }),
  totalEvents: z.number().int().nonnegative(),
  policyDenials: z.number().int().nonnegative(),
  approvalDenials: z.number().int().nonnegative(),
  executionFailures: z.number().int().nonnegative(),
  pluginCapabilityDenials: z.number().int().nonnegative(),
  nodeQuarantineEvents: z.number().int().nonnegative(),
  authFailures: z.number().int().nonnegative(),
  anomaliesDetected: z.number().int().nonnegative(),
  highSeverityEvents: z.number().int().nonnegative(),
  criticalSeverityEvents: z.number().int().nonnegative(),
  topDeniedPrincipals: z.array(z.object({ principalId: z.string().min(1), count: z.number().int().nonnegative() })).default([]),
  topDeniedResources: z.array(z.object({ resourceId: z.string().min(1), count: z.number().int().nonnegative() })).default([])
});
export type RiskSummary = z.infer<typeof riskSummarySchema>;

// ─── Audit query parameters ───────────────────────────────────────────────────

export const auditQuerySchema = z.object({
  traceId: z.string().min(1).optional(),
  sessionId: z.string().min(1).optional(),
  intentId: z.string().min(1).optional(),
  approvalId: z.string().min(1).optional(),
  executionRunId: z.string().min(1).optional(),
  nodeId: z.string().min(1).optional(),
  pluginId: z.string().min(1).optional(),
  principalId: z.string().min(1).optional(),
  resourceId: z.string().min(1).optional(),
  eventType: auditEventTypeSchema.optional(),
  severity: auditSeveritySchema.optional(),
  producingService: serviceNameSchema.optional(),
  fromTimestamp: z.string().datetime({ offset: true }).optional(),
  toTimestamp: z.string().datetime({ offset: true }).optional(),
  limit: z.number().int().positive().max(1000).default(100),
  offset: z.number().int().nonnegative().default(0),
  includeRedacted: z.boolean().default(false)
});
export type AuditQuery = z.infer<typeof auditQuerySchema>;

// ─── Audit event producer helper ──────────────────────────────────────────────

export interface CreateAuditEventInput {
  eventType: AuditEventType;
  producingService: AuditEvent["producingService"];
  traceId: string;
  correlationId: string;
  severity: AuditSeverity;
  payload?: Record<string, unknown>;
  actor?: AuditEvent["actor"];
  caller?: AuditEvent["caller"];
  tenantId?: string;
  workspaceId?: string;
  sessionId?: string;
  intentId?: string;
  approvalId?: string;
  executionRunId?: string;
  nodeId?: string;
  pluginId?: string;
  toolId?: string;
  memoryNamespace?: string;
  resource?: AuditResourceRef;
  trustClassification?: AuditEvent["trustClassification"];
  decisionOutcome?: DecisionOutcome;
  reasonCodes?: string[];
  parentTraceId?: string;
  spanId?: string;
}

export function createAuditEvent(input: CreateAuditEventInput): AuditEvent {
  const now = new Date().toISOString();
  return auditEventSchema.parse({
    schemaVersion: AUDIT_CONTRACT_VERSION,
    contractVersion: CONTRACT_SCHEMA_VERSION,
    auditId: `audit:${randomUUID()}`,
    eventType: input.eventType,
    timestamp: now,
    producingService: input.producingService,
    traceId: input.traceId,
    correlationId: input.correlationId,
    ...(input.parentTraceId !== undefined ? { parentTraceId: input.parentTraceId } : {}),
    ...(input.spanId !== undefined ? { spanId: input.spanId } : {}),
    ...(input.actor !== undefined ? { actor: input.actor } : {}),
    ...(input.caller !== undefined ? { caller: input.caller } : {}),
    ...(input.tenantId !== undefined ? { tenantId: input.tenantId } : {}),
    ...(input.workspaceId !== undefined ? { workspaceId: input.workspaceId } : {}),
    ...(input.sessionId !== undefined ? { sessionId: input.sessionId } : {}),
    ...(input.intentId !== undefined ? { intentId: input.intentId } : {}),
    ...(input.approvalId !== undefined ? { approvalId: input.approvalId } : {}),
    ...(input.executionRunId !== undefined ? { executionRunId: input.executionRunId } : {}),
    ...(input.nodeId !== undefined ? { nodeId: input.nodeId } : {}),
    ...(input.pluginId !== undefined ? { pluginId: input.pluginId } : {}),
    ...(input.toolId !== undefined ? { toolId: input.toolId } : {}),
    ...(input.memoryNamespace !== undefined ? { memoryNamespace: input.memoryNamespace } : {}),
    ...(input.resource !== undefined ? { resource: input.resource } : {}),
    ...(input.trustClassification !== undefined ? { trustClassification: input.trustClassification } : {}),
    ...(input.decisionOutcome !== undefined ? { decisionOutcome: input.decisionOutcome } : {}),
    severity: input.severity,
    reasonCodes: input.reasonCodes ?? [],
    redaction: { applied: false, redactedFields: [] },
    payload: input.payload ?? {}
  });
}

// ─── Compute content hash for tamper detection ────────────────────────────────

/**
 * Compute a stable SHA-256 hash of an audit event's content.
 * The `integrity` field is excluded so this can be used before integrity is attached.
 */
export function computeAuditEventContentHash(event: AuditEvent | Omit<AuditEvent, "integrity">): string {
  const raw = { ...event } as Partial<AuditEvent>;
  delete raw.integrity;
  const canonicalize = (value: unknown): unknown => {
    if (Array.isArray(value)) {
      return value.map((entry) => canonicalize(entry));
    }
    if (value && typeof value === "object") {
      return Object.keys(value as Record<string, unknown>)
        .sort()
        .reduce<Record<string, unknown>>((acc, key) => {
          acc[key] = canonicalize((value as Record<string, unknown>)[key]);
          return acc;
        }, {});
    }
    return value;
  };
  const rest = canonicalize(raw);
  const canonical = JSON.stringify(rest);
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}
