import { randomUUID } from "node:crypto";

import {
  type ActionClass,
  createExecutionIntent,
  type PolicyEvaluationResponse,
  type PolicyResourceReference,
  type ResolvedPrincipalContext
} from "@manasvi/contracts";

export function buildExecutionIntentFromPolicy(input: {
  decision: PolicyEvaluationResponse;
  principalContext: ResolvedPrincipalContext;
  tenantId: string;
  workspaceId: string;
  sessionId?: string;
  trace: { traceId: string; correlationId: string; parentTraceId?: string };
  action: {
    actionId: string;
    actionClass: ActionClass;
    operation: string;
    toolRef?: string;
    parameters: Record<string, unknown>;
  };
  target: PolicyResourceReference;
  requiredCapabilities: string[];
  ttlSeconds: number;
  idempotencyKey?: string;
}) {
  const expiresAt = new Date(Date.now() + input.ttlSeconds * 1000).toISOString();
  return createExecutionIntent({
    snapshot: {
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      actor: input.principalContext.actor,
      caller: input.principalContext.caller,
      ...(input.sessionId ? { originSessionId: input.sessionId } : {}),
      trace: input.trace,
      action: {
        actionId: input.action.actionId,
        actionClass: input.action.actionClass,
        operation: input.action.operation,
        ...(input.action.toolRef ? { toolRef: input.action.toolRef } : {}),
        parameters: input.action.parameters
      },
      target: input.target,
      requiredCapabilities: input.requiredCapabilities,
      risk: {
        score: input.decision.risk.score,
        level: input.decision.risk.level,
        reasons: input.decision.risk.factors
      },
      policy: {
        decisionId: input.decision.decisionId,
        decision: input.decision.decision,
        approvalRequired: input.decision.approvalRequired,
        reasonCodes: input.decision.reasonCodes,
        policySetVersion: input.decision.policySetVersion,
        policySourceRef: input.decision.policySourceRef,
        ...(input.decision.matchedPolicyId ? { matchedPolicyId: input.decision.matchedPolicyId } : {}),
        ...(input.decision.matchedRuleId ? { matchedRuleId: input.decision.matchedRuleId } : {}),
        auditRecordId: input.decision.auditRecordId
      },
      createdByService: "orchestrator-service",
      createdAt: new Date().toISOString(),
      expiresAt,
      idempotencyKey:
        input.idempotencyKey ??
        `intent:${input.tenantId}:${input.workspaceId}:${input.action.actionId}:${randomUUID()}`
    },
    approval: {
      state: input.decision.approvalRequired ? "pending" : "not_required",
      required: input.decision.approvalRequired,
      ...(input.decision.approvalRequired ? { requirementReason: input.decision.reasonCodes.join(",") } : {})
    },
    lifecycle:
      input.decision.decision === "DENY"
        ? "denied"
        : input.decision.approvalRequired
          ? "pending_approval"
          : "execution_authorized"
  });
}
