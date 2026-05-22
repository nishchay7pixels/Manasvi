export type GoogleProviderId = "gog" | "native";

export interface GoogleProviderHealth {
  provider: GoogleProviderId;
  ok: boolean;
  status:
    | "not_configured"
    | "not_connected"
    | "available"
    | "unavailable"
    | "not_implemented";
  account?: string;
  services: Record<string, {
    enabled: boolean;
    connected: boolean;
    reason?: string;
    grantedScopes?: string[];
    missingScopes?: string[];
  }>;
  warnings: string[];
  errors: string[];
  nextSteps: string[];
}

export interface GoogleCapabilityExecutionRequest<TInput = unknown> {
  capabilityId: string;
  input: TInput;
  principal?: {
    id?: string;
    type?: string;
  };
  correlationId?: string;
  dryRun?: boolean;
  approval?: {
    approved: boolean;
    approvalId?: string;
    approvedBy?: string;
    approvedAt?: string;
  };
}

export interface GoogleCapabilityExecutionResult<TResult = unknown> {
  ok: boolean;
  capabilityId: string;
  provider: GoogleProviderId;
  status:
    | "completed"
    | "blocked"
    | "not_configured"
    | "not_supported"
    | "not_connected"
    | "not_implemented"
    | "missing_scope"
    | "parser_error"
    | "failed";
  data?: TResult;
  warnings: string[];
  errors: string[];
  nextSteps?: string[];
  audit?: Record<string, unknown>;
}

export interface GoogleProvider {
  id: GoogleProviderId;

  healthCheck(): Promise<GoogleProviderHealth>;

  supports(capabilityId: string): boolean;

  execute<TInput = unknown, TResult = unknown>(
    request: GoogleCapabilityExecutionRequest<TInput>
  ): Promise<GoogleCapabilityExecutionResult<TResult>>;
}
