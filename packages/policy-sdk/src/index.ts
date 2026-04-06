export type PolicyDecisionResult = "ALLOW" | "DENY" | "REQUIRE_APPROVAL";

export interface PolicyEvaluationRequest {
  requestId: string;
  tenantId: string;
  principal: {
    type: string;
    id: string;
  };
  action: {
    type: string;
    resource: string;
    attributes?: Record<string, unknown>;
  };
  context?: Record<string, unknown>;
}

export interface PolicyEvaluationResponse {
  decisionId: string;
  result: PolicyDecisionResult;
  reasonCodes: string[];
  obligations: string[];
  ttlSeconds: number;
}

export interface PolicyClient {
  evaluate(request: PolicyEvaluationRequest): Promise<PolicyEvaluationResponse>;
}
