import { randomUUID } from "node:crypto";

import {
  decisionAuditRecordSchema,
  type DecisionAuditRecord,
  type PolicyDecisionResult,
  type PolicyEvaluationRequest,
  type PolicyEvaluationResponse,
  type PolicyRule,
  type PolicySet,
  type ResourceClass,
  type ActionClass
} from "@manasvi/contracts";

const sensitiveActionClasses = new Set<ActionClass>([
  "write",
  "execute",
  "register",
  "approve",
  "access-secret",
  "access-network",
  "access-filesystem",
  "mutate-memory",
  "skip-approval",
  "administer-policy",
  "external-side-effect",
  "destructive-action"
]);

const highSensitivityResourceClasses = new Set<ResourceClass>([
  "secret-reference",
  "filesystem-zone",
  "network-zone",
  "execution-node",
  "plugin-capability"
]);

const riskRank = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4
} as const;

export interface PolicyEngineResult {
  response: PolicyEvaluationResponse;
  auditRecord: DecisionAuditRecord;
}

export function evaluatePolicy(
  policySet: PolicySet,
  request: PolicyEvaluationRequest,
  options: { defaultDecisionTtlSeconds: number }
): PolicyEngineResult {
  if (!request.principalContext.authenticated) {
    return buildDecision({
      request,
      policySet,
      decision: "DENY",
      reasonCodes: ["UNAUTHENTICATED_PRINCIPAL_CONTEXT"],
      approvalRequired: false,
      matched: undefined,
      risk: assessRisk(request),
      ttlSeconds: options.defaultDecisionTtlSeconds
    });
  }

  const risk = assessRisk(request);
  const allRules = policySet.policies
    .filter((policy) => policy.enabled)
    .flatMap((policy) =>
      policy.rules
        .filter((rule) => rule.enabled)
        .map((rule) => ({
          policyId: policy.policyId,
          policyVersion: policy.policyVersion,
          rule
        }))
    );

  const matches = allRules
    .filter((entry) => matchesRule(entry.rule, request, risk))
    .sort((a, b) => b.rule.priority - a.rule.priority);

  const explicitDeny = matches.find((entry) => entry.rule.effect === "deny");
  if (explicitDeny) {
    return buildDecision({
      request,
      policySet,
      decision: "DENY",
      reasonCodes: ["EXPLICIT_DENY_POLICY"],
      approvalRequired: false,
      matched: explicitDeny,
      risk,
      ttlSeconds: options.defaultDecisionTtlSeconds
    });
  }

  if (matches.length === 0) {
    const reasonCodes = sensitiveActionClasses.has(request.action.actionClass)
      ? ["NO_MATCHING_POLICY_DENY_BY_DEFAULT"]
      : ["NO_MATCHING_POLICY"];
    return buildDecision({
      request,
      policySet,
      decision: "DENY",
      reasonCodes,
      approvalRequired: false,
      matched: undefined,
      risk,
      ttlSeconds: options.defaultDecisionTtlSeconds
    });
  }

  const chosen = matches[0]!;
  const missingCapabilities = chosen.rule.requiredCapabilities.filter(
    (required) => !request.requestedCapabilities.some((capability) => capability.capabilityId === required)
  );
  if (missingCapabilities.length > 0) {
    return buildDecision({
      request,
      policySet,
      decision: "DENY",
      reasonCodes: ["MISSING_REQUIRED_CAPABILITY", ...missingCapabilities.map((value) => `CAP:${value}`)],
      approvalRequired: false,
      matched: chosen,
      risk,
      ttlSeconds: options.defaultDecisionTtlSeconds
    });
  }

  if (risk.level === "high" || risk.level === "critical") {
    if (!chosen.rule.metadata.highRiskCoverage || !request.risk.requireExplicitRiskPolicy) {
      return buildDecision({
        request,
        policySet,
        decision: "DENY",
        reasonCodes: ["HIGH_RISK_REQUIRES_EXPLICIT_POLICY_COVERAGE"],
        approvalRequired: false,
        matched: chosen,
        risk,
        ttlSeconds: options.defaultDecisionTtlSeconds
      });
    }
  }

  if (request.approval.skipApprovalRequested && !chosen.rule.conditions.allowSkipApproval) {
    return buildDecision({
      request,
      policySet,
      decision: "DENY",
      reasonCodes: ["SKIP_APPROVAL_NOT_PERMITTED"],
      approvalRequired: false,
      matched: chosen,
      risk,
      ttlSeconds: options.defaultDecisionTtlSeconds
    });
  }

  if (chosen.rule.effect === "require_approval") {
    return buildDecision({
      request,
      policySet,
      decision: "REQUIRE_APPROVAL",
      reasonCodes: ["RULE_REQUIRES_APPROVAL"],
      approvalRequired: true,
      matched: chosen,
      risk,
      ttlSeconds: options.defaultDecisionTtlSeconds
    });
  }

  if (chosen.rule.effect === "conditional_allow") {
    const conditions = [`rule:${chosen.rule.ruleId}`];
    if (!request.approval.approvalPresent) {
      return buildDecision({
        request,
        policySet,
        decision: "REQUIRE_APPROVAL",
        reasonCodes: ["CONDITIONAL_ALLOW_REQUIRES_APPROVAL"],
        approvalRequired: true,
        matched: chosen,
        risk,
        ttlSeconds: options.defaultDecisionTtlSeconds,
        conditions
      });
    }
    return buildDecision({
      request,
      policySet,
      decision: "CONDITIONAL_ALLOW",
      reasonCodes: ["CONDITIONAL_ALLOW_SATISFIED"],
      approvalRequired: false,
      matched: chosen,
      risk,
      ttlSeconds: options.defaultDecisionTtlSeconds,
      conditions
    });
  }

  return buildDecision({
    request,
    policySet,
    decision: "ALLOW",
    reasonCodes: ["ALLOW_BY_POLICY"],
    approvalRequired: false,
    matched: chosen,
    risk,
    ttlSeconds: options.defaultDecisionTtlSeconds
  });
}

function matchesRule(
  rule: PolicyRule,
  request: PolicyEvaluationRequest,
  risk: { level: "low" | "medium" | "high" | "critical"; score: number; factors: string[] }
): boolean {
  if (!rule.actionClasses.includes(request.action.actionClass)) {
    return false;
  }
  if (!rule.resourceClasses.includes(request.resource.resourceClass)) {
    return false;
  }
  if (!rule.resourceIdPatterns.some((pattern) => wildcardMatch(pattern, request.resource.resourceId))) {
    return false;
  }
  if (rule.selectors.callerTypes.length > 0) {
    if (!rule.selectors.callerTypes.includes(request.principalContext.caller.principalType)) {
      return false;
    }
  }
  if (rule.selectors.actorTypes.length > 0) {
    if (!rule.selectors.actorTypes.includes(request.principalContext.actor.principalType)) {
      return false;
    }
  }
  if (rule.selectors.callerIds.length > 0) {
    if (!rule.selectors.callerIds.includes(request.principalContext.caller.principalId)) {
      return false;
    }
  }
  if (rule.selectors.actorIds.length > 0) {
    if (!rule.selectors.actorIds.includes(request.principalContext.actor.principalId)) {
      return false;
    }
  }
  if (rule.conditions.requireTenantMatch) {
    if (
      request.tenantId !== request.principalContext.tenantId ||
      (request.resource.tenantId && request.resource.tenantId !== request.tenantId)
    ) {
      return false;
    }
  }
  if (rule.conditions.requireWorkspaceMatch) {
    if (
      request.workspaceId !== request.principalContext.workspaceId ||
      (request.resource.workspaceId && request.resource.workspaceId !== request.workspaceId)
    ) {
      return false;
    }
  }
  if (rule.conditions.maxRiskLevel) {
    if (riskRank[risk.level] > riskRank[rule.conditions.maxRiskLevel]) {
      return false;
    }
  }
  return true;
}

export function assessRisk(request: PolicyEvaluationRequest): {
  score: number;
  level: "low" | "medium" | "high" | "critical";
  factors: string[];
} {
  let score = 10;
  const factors: string[] = [];

  if (sensitiveActionClasses.has(request.action.actionClass)) {
    score += 25;
    factors.push(`sensitive_action:${request.action.actionClass}`);
  }
  if (highSensitivityResourceClasses.has(request.resource.resourceClass)) {
    score += 20;
    factors.push(`sensitive_resource:${request.resource.resourceClass}`);
  }
  if (request.principalContext.caller.principalType === "plugin") {
    score += 15;
    factors.push("plugin_origin");
  }
  if (request.resource.resourceClass === "execution-node" && request.resource.resourceId.startsWith("node:remote")) {
    score += 15;
    factors.push("remote_node_execution");
  }
  if (request.approval.skipApprovalRequested) {
    score += 20;
    factors.push("approval_bypass_attempt");
  }
  if (request.risk.flags.includes("cross-tenant")) {
    score += 25;
    factors.push("cross_tenant_flag");
  }
  if (request.risk.declaredLevel === "critical") {
    score += 40;
    factors.push("declared_critical");
  } else if (request.risk.declaredLevel === "high") {
    score += 25;
    factors.push("declared_high");
  }

  score = Math.min(score, 100);
  const level =
    score >= 80 ? "critical" : score >= 60 ? "high" : score >= 35 ? "medium" : "low";
  return {
    score,
    level,
    factors
  };
}

function buildDecision(input: {
  request: PolicyEvaluationRequest;
  policySet: PolicySet;
  decision: PolicyDecisionResult;
  reasonCodes: string[];
  approvalRequired: boolean;
  matched:
    | {
        policyId: string;
        policyVersion: string;
        rule: PolicyRule;
      }
    | undefined;
  risk: { score: number; level: "low" | "medium" | "high" | "critical"; factors: string[] };
  ttlSeconds: number;
  conditions?: string[];
}): PolicyEngineResult {
  const decisionId = `decision:${randomUUID()}`;
  const auditRecordId = `audit:${randomUUID()}`;
  const response: PolicyEvaluationResponse = {
    schemaVersion: "1.0",
    decisionId,
    decision: input.decision,
    reasonCodes: input.reasonCodes,
    approvalRequired: input.approvalRequired,
    conditions: input.conditions ?? [],
    risk: input.risk,
    ...(input.matched ? { matchedPolicyId: input.matched.policyId } : {}),
    ...(input.matched ? { matchedPolicyVersion: input.matched.policyVersion } : {}),
    ...(input.matched ? { matchedRuleId: input.matched.rule.ruleId } : {}),
    policySetVersion: input.policySet.policySetVersion,
    policySourceRef: input.policySet.sourceRef,
    ttlSeconds: input.ttlSeconds,
    auditRecordId,
    trace: input.request.trace
  };
  const auditRecord = decisionAuditRecordSchema.parse({
    schemaVersion: "1.0",
    auditRecordId,
    decisionId,
    timestamp: new Date().toISOString(),
    callerPrincipal: input.request.principalContext.caller,
    actorPrincipal: input.request.principalContext.actor,
    requestingService: input.request.requestingService,
    actionClass: input.request.action.actionClass,
    actionId: input.request.action.actionId,
    resourceClass: input.request.resource.resourceClass,
    resourceId: input.request.resource.resourceId,
    tenantId: input.request.tenantId,
    workspaceId: input.request.workspaceId,
    ...(input.matched ? { matchedPolicyId: input.matched.policyId } : {}),
    ...(input.matched ? { matchedPolicyVersion: input.matched.policyVersion } : {}),
    ...(input.matched ? { matchedRuleId: input.matched.rule.ruleId } : {}),
    decision: input.decision,
    reasonCodes: input.reasonCodes,
    approvalRequired: input.approvalRequired,
    risk: input.risk,
    trace: input.request.trace
  });
  return {
    response,
    auditRecord
  };
}

function wildcardMatch(pattern: string, value: string): boolean {
  if (pattern === "*") {
    return true;
  }
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  const regex = new RegExp(`^${escaped}$`);
  return regex.test(value);
}
