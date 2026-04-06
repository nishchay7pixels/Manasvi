import { randomUUID } from "node:crypto";
import { z } from "zod";

import { CONTRACT_SCHEMA_VERSION, trustClassSchema } from "./base.js";
import { principalReferenceSchema, resolvedPrincipalContextSchema } from "./identity.js";

export const POLICY_CONTRACT_VERSION = "1.0" as const;

export const actionClassSchema = z.enum([
  "read",
  "write",
  "execute",
  "register",
  "invoke",
  "approve",
  "access-secret",
  "access-network",
  "access-filesystem",
  "mutate-memory",
  "publish-event",
  "consume-event",
  "skip-approval",
  "administer-policy"
]);
export type ActionClass = z.infer<typeof actionClassSchema>;

export const resourceClassSchema = z.enum([
  "memory-namespace",
  "tool-endpoint",
  "filesystem-zone",
  "network-zone",
  "plugin-capability",
  "execution-node",
  "channel-surface",
  "secret-reference",
  "agent-definition",
  "approval-authority",
  "session",
  "tenant-workspace-boundary",
  "audit-stream",
  "plugin-runtime",
  "service-endpoint"
]);
export type ResourceClass = z.infer<typeof resourceClassSchema>;

export const policyDecisionResultSchema = z.enum([
  "ALLOW",
  "DENY",
  "REQUIRE_APPROVAL",
  "CONDITIONAL_ALLOW"
]);
export type PolicyDecisionResult = z.infer<typeof policyDecisionResultSchema>;

export const capabilitySchema = z.object({
  capabilityId: z.string().min(1),
  scope: z.object({
    tenantId: z.string().min(1).optional(),
    workspaceId: z.string().min(1).optional(),
    resourceClass: resourceClassSchema.optional(),
    resourcePattern: z.string().min(1).optional()
  }),
  constraints: z.record(z.unknown()).default({})
});
export type Capability = z.infer<typeof capabilitySchema>;

export const policyResourceReferenceSchema = z.object({
  resourceClass: resourceClassSchema,
  resourceId: z.string().min(1),
  tenantId: z.string().min(1).optional(),
  workspaceId: z.string().min(1).optional(),
  ownerPrincipalId: z.string().min(1).optional(),
  attributes: z.record(z.unknown()).default({})
});
export type PolicyResourceReference = z.infer<typeof policyResourceReferenceSchema>;

export const policyRiskInputSchema = z.object({
  declaredLevel: z.enum(["low", "medium", "high", "critical"]).optional(),
  flags: z.array(z.string().min(1)).default([]),
  requireExplicitRiskPolicy: z.boolean().default(true),
  trustClassification: trustClassSchema.optional()
});
export type PolicyRiskInput = z.infer<typeof policyRiskInputSchema>;

export const policyApprovalContextSchema = z.object({
  approvalPresent: z.boolean().default(false),
  approvalId: z.string().min(1).optional(),
  skipApprovalRequested: z.boolean().default(false)
});
export type PolicyApprovalContext = z.infer<typeof policyApprovalContextSchema>;

export const policyTraceSchema = z.object({
  traceId: z.string().uuid(),
  correlationId: z.string().uuid(),
  parentTraceId: z.string().uuid().optional()
});
export type PolicyTrace = z.infer<typeof policyTraceSchema>;

export const policyEvaluationRequestSchema = z.object({
  schemaVersion: z.literal(POLICY_CONTRACT_VERSION),
  requestId: z.string().min(1),
  timestamp: z.string().datetime({ offset: true }),
  requestingService: principalReferenceSchema,
  principalContext: resolvedPrincipalContextSchema,
  action: z.object({
    actionClass: actionClassSchema,
    actionId: z.string().min(1),
    attributes: z.record(z.unknown()).default({})
  }),
  resource: policyResourceReferenceSchema,
  requestedCapabilities: z.array(capabilitySchema).default([]),
  tenantId: z.string().min(1),
  workspaceId: z.string().min(1),
  session: z
    .object({
      sessionId: z.string().min(1),
      sessionOwner: principalReferenceSchema.optional()
    })
    .optional(),
  approval: policyApprovalContextSchema.default({
    approvalPresent: false,
    skipApprovalRequested: false
  }),
  risk: policyRiskInputSchema.default({
    flags: [],
    requireExplicitRiskPolicy: true
  }),
  environment: z
    .object({
      sourceIp: z.string().min(1).optional(),
      runtimeProfile: z.string().min(1).optional(),
      attributes: z.record(z.unknown()).default({})
    })
    .default({
      attributes: {}
    }),
  trace: policyTraceSchema
});
export type PolicyEvaluationRequest = z.infer<typeof policyEvaluationRequestSchema>;

export const policyRiskAssessmentSchema = z.object({
  score: z.number().min(0).max(100),
  level: z.enum(["low", "medium", "high", "critical"]),
  factors: z.array(z.string().min(1))
});
export type PolicyRiskAssessment = z.infer<typeof policyRiskAssessmentSchema>;

export const policyEvaluationResponseSchema = z.object({
  schemaVersion: z.literal(POLICY_CONTRACT_VERSION),
  decisionId: z.string().min(1),
  decision: policyDecisionResultSchema,
  reasonCodes: z.array(z.string().min(1)),
  approvalRequired: z.boolean(),
  conditions: z.array(z.string().min(1)).default([]),
  risk: policyRiskAssessmentSchema,
  matchedPolicyId: z.string().min(1).optional(),
  matchedPolicyVersion: z.string().min(1).optional(),
  matchedRuleId: z.string().min(1).optional(),
  policySetVersion: z.string().min(1),
  policySourceRef: z.string().min(1),
  ttlSeconds: z.number().int().positive(),
  auditRecordId: z.string().min(1),
  trace: policyTraceSchema
});
export type PolicyEvaluationResponse = z.infer<typeof policyEvaluationResponseSchema>;

export const decisionAuditRecordSchema = z.object({
  schemaVersion: z.literal(POLICY_CONTRACT_VERSION),
  auditRecordId: z.string().min(1),
  decisionId: z.string().min(1),
  timestamp: z.string().datetime({ offset: true }),
  callerPrincipal: principalReferenceSchema,
  actorPrincipal: principalReferenceSchema,
  requestingService: principalReferenceSchema,
  actionClass: actionClassSchema,
  actionId: z.string().min(1),
  resourceClass: resourceClassSchema,
  resourceId: z.string().min(1),
  tenantId: z.string().min(1),
  workspaceId: z.string().min(1),
  matchedPolicyId: z.string().min(1).optional(),
  matchedPolicyVersion: z.string().min(1).optional(),
  matchedRuleId: z.string().min(1).optional(),
  decision: policyDecisionResultSchema,
  reasonCodes: z.array(z.string().min(1)),
  approvalRequired: z.boolean(),
  risk: policyRiskAssessmentSchema,
  trace: policyTraceSchema
});
export type DecisionAuditRecord = z.infer<typeof decisionAuditRecordSchema>;

export const policyRuleEffectSchema = z.enum(["allow", "deny", "require_approval", "conditional_allow"]);
export type PolicyRuleEffect = z.infer<typeof policyRuleEffectSchema>;

export const policyRuleSchema = z.object({
  ruleId: z.string().min(1),
  description: z.string().min(1),
  priority: z.number().int().default(100),
  effect: policyRuleEffectSchema,
  enabled: z.boolean().default(true),
  selectors: z.object({
    callerTypes: z.array(principalReferenceSchema.shape.principalType).default([]),
    actorTypes: z.array(principalReferenceSchema.shape.principalType).default([]),
    callerIds: z.array(z.string().min(1)).default([]),
    actorIds: z.array(z.string().min(1)).default([])
  }),
  actionClasses: z.array(actionClassSchema).min(1),
  resourceClasses: z.array(resourceClassSchema).min(1),
  resourceIdPatterns: z.array(z.string().min(1)).default(["*"]),
  requiredCapabilities: z.array(capabilitySchema.shape.capabilityId).default([]),
  conditions: z.object({
    requireTenantMatch: z.boolean().default(true),
    requireWorkspaceMatch: z.boolean().default(true),
    allowSkipApproval: z.boolean().default(false),
    maxRiskLevel: z.enum(["low", "medium", "high", "critical"]).optional()
  }),
  metadata: z.object({
    highRiskCoverage: z.boolean().default(false),
    tags: z.array(z.string().min(1)).default([])
  })
});
export type PolicyRule = z.infer<typeof policyRuleSchema>;

export const policyDocumentSchema = z.object({
  policyId: z.string().min(1),
  policyVersion: z.string().min(1),
  description: z.string().min(1),
  enabled: z.boolean().default(true),
  rules: z.array(policyRuleSchema).min(1)
});
export type PolicyDocument = z.infer<typeof policyDocumentSchema>;

export const policySetSchema = z.object({
  schemaVersion: z.literal(POLICY_CONTRACT_VERSION),
  contractVersion: z.literal(CONTRACT_SCHEMA_VERSION),
  policySetVersion: z.string().min(1),
  sourceRef: z.string().min(1),
  loadedAt: z.string().datetime({ offset: true }),
  policies: z.array(policyDocumentSchema).min(1)
});
export type PolicySet = z.infer<typeof policySetSchema>;

export const policyLoadAuditRecordSchema = z.object({
  schemaVersion: z.literal(POLICY_CONTRACT_VERSION),
  eventId: z.string().min(1),
  timestamp: z.string().datetime({ offset: true }),
  policySetVersion: z.string().min(1),
  sourceRef: z.string().min(1),
  digest: z.string().min(1),
  loadedByService: z.string().min(1)
});
export type PolicyLoadAuditRecord = z.infer<typeof policyLoadAuditRecordSchema>;

export function createPolicyEvaluationRequest(
  input: Omit<PolicyEvaluationRequest, "schemaVersion" | "requestId" | "timestamp">
): PolicyEvaluationRequest {
  return policyEvaluationRequestSchema.parse({
    schemaVersion: POLICY_CONTRACT_VERSION,
    requestId: randomUUID(),
    timestamp: new Date().toISOString(),
    ...input
  });
}

