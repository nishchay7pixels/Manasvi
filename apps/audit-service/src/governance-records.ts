import { randomUUID } from "node:crypto";

import {
  auditApprovalRecordSchema,
  decisionRecordSchema,
  toolExecutionRecordSchema,
  type AuditApprovalRecord,
  type AuditEvent,
  type DecisionRecord,
  type ToolExecutionRecord
} from "@manasvi/contracts";

function buildTrace(event: AuditEvent) {
  return {
    traceId: event.traceId,
    correlationId: event.correlationId,
    ...(event.parentTraceId ? { parentTraceId: event.parentTraceId } : {})
  };
}

export function toDecisionRecord(event: AuditEvent): DecisionRecord | undefined {
  const decisionType = event.eventType.startsWith("policy.decision")
    ? "policy"
    : event.eventType.startsWith("approval.")
      ? "approval"
      : event.eventType.startsWith("identity.")
        ? "identity"
        : event.eventType === "memory.promoted"
          ? "trust_promotion"
          : event.eventType === "plugin.capability_denied"
            ? "capability"
            : undefined;
  if (!decisionType) {
    return undefined;
  }
  const actionClass =
    typeof event.payload.actionClass === "string"
      ? event.payload.actionClass
      : event.toolId
        ? "tool-action"
        : "governance-action";
  const resourceClass = event.resource?.resourceClass ?? "unknown";
  const resourceId = event.resource?.resourceId ?? event.intentId ?? event.approvalId ?? event.auditId;
  return decisionRecordSchema.parse({
    schemaVersion: "1.0",
    decisionId: `decision:${randomUUID()}`,
    auditId: event.auditId,
    decisionType,
    timestamp: event.timestamp,
    producingService: event.producingService,
    trace: buildTrace(event),
    ...(event.actor ? { actor: event.actor } : {}),
    ...(event.caller ? { caller: event.caller } : {}),
    ...(event.tenantId ? { tenantId: event.tenantId } : {}),
    ...(event.workspaceId ? { workspaceId: event.workspaceId } : {}),
    ...(event.sessionId ? { sessionId: event.sessionId } : {}),
    actionClass,
    resourceClass,
    resourceId,
    outcome: event.decisionOutcome ?? "pending",
    reasonCodes: event.reasonCodes,
    ...(typeof event.payload.matchedPolicyId === "string" ? { matchedPolicyId: event.payload.matchedPolicyId } : {}),
    ...(typeof event.payload.matchedRuleId === "string" ? { matchedRuleId: event.payload.matchedRuleId } : {}),
    approvalRequired: event.eventType === "policy.decision.require_approval",
    ...(typeof event.payload.riskLevel === "string" ? { riskLevel: event.payload.riskLevel } : {}),
    ...(typeof event.payload.riskScore === "number" ? { riskScore: event.payload.riskScore } : {}),
    ...(event.intentId ? { linkedIntentId: event.intentId } : {}),
    ...(event.approvalId ? { linkedApprovalId: event.approvalId } : {}),
    ...(event.executionRunId ? { linkedExecutionId: event.executionRunId } : {})
  });
}

export function toApprovalRecord(event: AuditEvent): AuditApprovalRecord | undefined {
  if (!event.eventType.startsWith("approval.")) {
    return undefined;
  }
  const stateByEvent: Record<AuditEvent["eventType"], AuditApprovalRecord["state"] | undefined> = {
    "approval.requested": "requested",
    "approval.granted": "granted",
    "approval.denied": "denied",
    "approval.expired": "expired",
    "approval.revoked": "revoked"
  } as Record<AuditEvent["eventType"], AuditApprovalRecord["state"] | undefined>;
  const state = stateByEvent[event.eventType];
  if (!state || !event.approvalId || !event.intentId) {
    return undefined;
  }
  return auditApprovalRecordSchema.parse({
    schemaVersion: "1.0",
    approvalRecordId: `approval-record:${randomUUID()}`,
    approvalId: event.approvalId,
    linkedIntentId: event.intentId,
    timestamp: event.timestamp,
    producingService: event.producingService,
    trace: buildTrace(event),
    state,
    ...(event.actor ? { actor: event.actor } : {}),
    ...(event.caller ? { caller: event.caller } : {}),
    ...(typeof event.payload.approver === "object" && event.payload.approver ? { approver: event.payload.approver } : {}),
    ...(event.sessionId ? { sessionId: event.sessionId } : {}),
    ...(event.tenantId ? { tenantId: event.tenantId } : {}),
    ...(event.workspaceId ? { workspaceId: event.workspaceId } : {}),
    ...(typeof event.payload.payloadHash === "string" ? { payloadHash: event.payload.payloadHash } : {}),
    ...(typeof event.payload.approvedArtifactId === "string"
      ? { approvedArtifactId: event.payload.approvedArtifactId }
      : {}),
    reasonCodes: event.reasonCodes,
    context: event.payload
  });
}

export function toToolExecutionRecord(event: AuditEvent): ToolExecutionRecord | undefined {
  const typeToStatus: Partial<Record<AuditEvent["eventType"], ToolExecutionRecord["status"]>> = {
    "execution.started": "started",
    "execution.completed": "completed",
    "execution.failed": "failed",
    "execution.timeout": "timed_out",
    "execution.quota_exceeded": "quota_exceeded",
    "intent.rejected": "validation_failed"
  };
  const status = typeToStatus[event.eventType];
  if (!status || !event.executionRunId || !event.toolId) {
    return undefined;
  }
  return toolExecutionRecordSchema.parse({
    schemaVersion: "1.0",
    executionRecordId: `execution-record:${randomUUID()}`,
    timestamp: event.timestamp,
    producingService: event.producingService,
    trace: buildTrace(event),
    runId: event.executionRunId,
    ...(event.intentId ? { intentId: event.intentId } : {}),
    ...(event.approvalId ? { approvalId: event.approvalId } : {}),
    toolId: event.toolId,
    ...(typeof event.payload.toolVersion === "string" ? { toolVersion: event.payload.toolVersion } : {}),
    ...(event.nodeId ? { nodeId: event.nodeId } : {}),
    sandboxMode:
      typeof event.payload.sandboxMode === "string" ? event.payload.sandboxMode : "unknown",
    runtimePolicySummary:
      typeof event.payload.runtimePolicySummary === "object" && event.payload.runtimePolicySummary
        ? (event.payload.runtimePolicySummary as Record<string, unknown>)
        : {},
    ...(typeof event.payload.startedAt === "string" ? { startedAt: event.payload.startedAt } : {}),
    ...(typeof event.payload.endedAt === "string" ? { endedAt: event.payload.endedAt } : {}),
    ...(typeof event.payload.durationMs === "number" ? { durationMs: event.payload.durationMs } : {}),
    status,
    ...(typeof event.payload.errorCode === "string" ? { errorCode: event.payload.errorCode } : {}),
    ...(event.actor ? { actor: event.actor } : {}),
    ...(event.caller ? { caller: event.caller } : {}),
    ...(event.sessionId ? { sessionId: event.sessionId } : {}),
    ...(event.tenantId ? { tenantId: event.tenantId } : {}),
    ...(event.workspaceId ? { workspaceId: event.workspaceId } : {}),
    ...(typeof event.payload.resultArtifactId === "string"
      ? { resultArtifactId: event.payload.resultArtifactId }
      : {})
  });
}
