export type ExecutionRisk = "low" | "medium" | "high" | "critical";

export interface ExecutionIntentRef {
  intentId: string;
  tenantId: string;
  payloadHash: string;
  expiresAt: string;
}

export interface ExecutionDispatchRequest {
  traceId: string;
  correlationId: string;
  intent: ExecutionIntentRef;
  sandboxProfile: "read_only" | "bounded_egress" | "mutation_limited" | "privileged_reviewed";
}

export interface ExecutionDispatchResult {
  accepted: boolean;
  executionId?: string;
  rejectionReason?: string;
}

export interface ExecutorClient {
  dispatch(request: ExecutionDispatchRequest): Promise<ExecutionDispatchResult>;
}
