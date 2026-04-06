import {
  policyEvaluationRequestSchema,
  policyEvaluationResponseSchema,
  type PolicyEvaluationRequest,
  type PolicyEvaluationResponse
} from "@manasvi/contracts";

export interface PolicyClient {
  evaluate(request: PolicyEvaluationRequest): Promise<PolicyEvaluationResponse>;
}

export interface HttpPolicyClientOptions {
  baseUrl: string;
  timeoutMs?: number;
  getAuthToken?: () => Promise<string> | string;
}

export class HttpPolicyClient implements PolicyClient {
  constructor(private readonly options: HttpPolicyClientOptions) {}

  async evaluate(request: PolicyEvaluationRequest): Promise<PolicyEvaluationResponse> {
    const parsedRequest = policyEvaluationRequestSchema.parse(request);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 5000);
    try {
      const authToken = this.options.getAuthToken ? await this.options.getAuthToken() : undefined;
      const response = await fetch(`${this.options.baseUrl.replace(/\/$/, "")}/policy/evaluate`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(authToken ? { authorization: `Bearer ${authToken}` } : {})
        },
        body: JSON.stringify(parsedRequest),
        signal: controller.signal
      });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(
          `Policy evaluation failed with status ${response.status}: ${JSON.stringify(body)}`
        );
      }
      return policyEvaluationResponseSchema.parse(body);
    } finally {
      clearTimeout(timeout);
    }
  }
}
