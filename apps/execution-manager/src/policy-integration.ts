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

export interface ExecutionPolicyQueryInput {
  principalContext: ResolvedPrincipalContext;
  actionClass: ActionClass;
  actionId: string;
  resource: PolicyResourceReference;
  requestedCapabilities: string[];
  tenantId: string;
  workspaceId: string;
  trace: PolicyTrace;
  skipApprovalRequested?: boolean;
  riskFlags?: string[];
  riskDeclaredLevel?: "low" | "medium" | "high" | "critical";
}

export async function queryPolicyForExecution(
  policyClient: PolicyClient,
  input: ExecutionPolicyQueryInput
): Promise<PolicyEvaluationResponse> {
  const request = createPolicyEvaluationRequest({
    requestingService: buildServicePrincipalReference("execution-manager"),
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
