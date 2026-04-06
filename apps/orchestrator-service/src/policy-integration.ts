import {
  buildServicePrincipalReference
} from "@manasvi/auth";
import {
  createPolicyEvaluationRequest,
  type ActionClass,
  type PolicyEvaluationResponse,
  type PolicyResourceReference,
  type PolicyTrace,
  type ResolvedPrincipalContext
} from "@manasvi/contracts";
import { type PolicyClient } from "@manasvi/policy-sdk";

export interface OrchestratorPolicyQueryInput {
  principalContext: ResolvedPrincipalContext;
  actionClass: ActionClass;
  actionId: string;
  resource: PolicyResourceReference;
  requestedCapabilities: string[];
  tenantId: string;
  workspaceId: string;
  trace: PolicyTrace;
  sessionId?: string;
  skipApprovalRequested?: boolean;
  riskFlags?: string[];
  riskDeclaredLevel?: "low" | "medium" | "high" | "critical";
}

export async function queryPolicyForOrchestration(
  policyClient: PolicyClient,
  input: OrchestratorPolicyQueryInput
): Promise<PolicyEvaluationResponse> {
  const request = createPolicyEvaluationRequest({
    requestingService: buildServicePrincipalReference("orchestrator-service"),
    principalContext: input.principalContext,
    action: {
      actionClass: input.actionClass,
      actionId: input.actionId,
      attributes: {}
    },
    resource: input.resource,
    requestedCapabilities: input.requestedCapabilities.map((capabilityId) => ({
      capabilityId,
      scope: {
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        resourceClass: input.resource.resourceClass
      },
      constraints: {}
    })),
    tenantId: input.tenantId,
    workspaceId: input.workspaceId,
    ...(input.sessionId
      ? {
          session: {
            sessionId: input.sessionId,
            ...(input.principalContext.sessionOwner
              ? { sessionOwner: input.principalContext.sessionOwner }
              : {})
          }
        }
      : {}),
    approval: {
      approvalPresent: false,
      skipApprovalRequested: input.skipApprovalRequested ?? false
    },
    risk: {
      declaredLevel: input.riskDeclaredLevel,
      flags: input.riskFlags ?? [],
      requireExplicitRiskPolicy: true
    },
    environment: {
      attributes: {}
    },
    trace: input.trace
  });
  return policyClient.evaluate(request);
}
