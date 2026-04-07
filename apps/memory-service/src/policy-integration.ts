import { buildServicePrincipalReference } from "@manasvi/auth";
import {
  createPolicyEvaluationRequest,
  type ActionClass,
  type PolicyEvaluationResponse,
  type PolicyTrace,
  type ResolvedPrincipalContext
} from "@manasvi/contracts";
import { type PolicyClient } from "@manasvi/policy-sdk";

export interface MemoryPolicyQueryInput {
  principalContext: ResolvedPrincipalContext;
  actionClass: ActionClass;
  actionId: string;
  namespace: string;
  tenantId: string;
  workspaceId: string;
  requestedCapabilities: string[];
  trace: PolicyTrace;
  riskFlags?: string[];
}

export async function queryPolicyForMemory(
  policyClient: PolicyClient,
  input: MemoryPolicyQueryInput
): Promise<PolicyEvaluationResponse> {
  const request = createPolicyEvaluationRequest({
    requestingService: buildServicePrincipalReference("memory-service"),
    principalContext: input.principalContext,
    action: {
      actionClass: input.actionClass,
      actionId: input.actionId,
      attributes: {
        namespace: input.namespace
      }
    },
    resource: {
      resourceClass: "memory-namespace",
      resourceId: input.namespace,
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      attributes: {}
    },
    requestedCapabilities: input.requestedCapabilities.map((capabilityId) => ({
      capabilityId,
      scope: {
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        resourceClass: "memory-namespace"
      },
      constraints: {}
    })),
    tenantId: input.tenantId,
    workspaceId: input.workspaceId,
    approval: {
      approvalPresent: false,
      skipApprovalRequested: false
    },
    risk: {
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
