import type { HealthResponse, ReadinessResponse } from "@manasvi/contracts";

export function assertHealthResponse(value: unknown): asserts value is HealthResponse {
  if (typeof value !== "object" || value === null) {
    throw new Error("Expected health response object");
  }
  const candidate = value as Partial<HealthResponse>;
  if (candidate.status !== "ok") {
    throw new Error("Health response status must be ok");
  }
  if (!candidate.metadata?.serviceName) {
    throw new Error("Health response missing metadata.serviceName");
  }
}

export function assertReadinessResponse(value: unknown): asserts value is ReadinessResponse {
  if (typeof value !== "object" || value === null) {
    throw new Error("Expected readiness response object");
  }
  const candidate = value as Partial<ReadinessResponse>;
  if (!candidate.status || !["ready", "not_ready"].includes(candidate.status)) {
    throw new Error("Readiness status is invalid");
  }
  if (!Array.isArray(candidate.checks)) {
    throw new Error("Readiness checks must be an array");
  }
}

export async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from ${url}`);
  }
  return response.json();
}
