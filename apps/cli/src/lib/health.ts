/**
 * Health check utilities — polls service HTTP endpoints.
 */

import type { ManasviConfig } from "./config.js";

export interface ServiceSpec {
  name: string;
  port: number;
  label: string;
  optional?: boolean;
}

export function getServiceSpecs(config: ManasviConfig): ServiceSpec[] {
  const s = config.services;
  return [
    { name: "api-gateway", port: s.gatewayPort, label: "API Gateway" },
    { name: "ingress-service", port: s.ingressPort, label: "Ingress" },
    { name: "orchestrator-service", port: s.orchestratorPort, label: "Orchestrator" },
    { name: "policy-service", port: s.policyPort, label: "Policy" },
    { name: "execution-manager", port: s.executionPort, label: "Execution Manager" },
    { name: "memory-service", port: s.memoryPort, label: "Memory" },
    { name: "node-manager", port: s.nodeManagerPort, label: "Node Manager" },
    { name: "audit-service", port: s.auditPort, label: "Audit" },
    { name: "approval-service", port: s.approvalPort, label: "Approval" }
  ];
}

export type ServiceStatus = "healthy" | "degraded" | "down" | "unreachable";

export interface ServiceHealth {
  name: string;
  label: string;
  port: number;
  status: ServiceStatus;
  latencyMs?: number;
  optional: boolean;
}

async function pingService(port: number, timeoutMs = 3000): Promise<{ ok: boolean; latencyMs: number }> {
  const start = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`http://localhost:${port}/health`, {
      signal: controller.signal
    });
    clearTimeout(timer);
    const latencyMs = Date.now() - start;
    return { ok: res.ok, latencyMs };
  } catch {
    clearTimeout(timer);
    return { ok: false, latencyMs: Date.now() - start };
  }
}

export async function checkServiceHealth(spec: ServiceSpec): Promise<ServiceHealth> {
  const { ok, latencyMs } = await pingService(spec.port);
  return {
    name: spec.name,
    label: spec.label,
    port: spec.port,
    status: ok ? "healthy" : "down",
    latencyMs: ok ? latencyMs : undefined,
    optional: spec.optional ?? false
  };
}

export async function checkAllServices(config: ManasviConfig): Promise<ServiceHealth[]> {
  const specs = getServiceSpecs(config);
  return Promise.all(specs.map(checkServiceHealth));
}

/**
 * Wait for a service to become healthy, with retries.
 */
export async function waitForService(
  port: number,
  timeoutMs = 30000,
  intervalMs = 500
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { ok } = await pingService(port, 2000);
    if (ok) return true;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}

/**
 * Check if Ollama is running at a given base URL.
 */
export async function checkOllama(baseUrl: string): Promise<boolean> {
  try {
    const url = baseUrl.replace(/\/v1\/?$/, "");
    const res = await fetch(`${url}/api/tags`, {
      signal: AbortSignal.timeout(3000)
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Check if an OpenAI-compatible API key works.
 */
export async function checkOpenAI(baseUrl: string, apiKey: string): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(5000)
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function checkDeepSeek(baseUrl: string, apiKey: string): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(5000)
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Check if Anthropic API key works.
 */
export async function checkAnthropic(baseUrl: string, apiKey: string): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/v1/models`, {
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      signal: AbortSignal.timeout(5000)
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * List Anthropic model ids for interactive selection. Returns [] on failure.
 */
export async function listAnthropicModels(baseUrl: string, apiKey: string): Promise<string[]> {
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/v1/models`, {
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      signal: AbortSignal.timeout(8000)
    });
    if (!res.ok) {
      return [];
    }
    const payload = await res.json() as { data?: Array<{ id?: string }> };
    return (payload.data ?? [])
      .map((entry) => entry.id)
      .filter((id): id is string => typeof id === "string" && id.length > 0);
  } catch {
    return [];
  }
}

/**
 * Check if a TCP port is already in use.
 */
export async function isPortInUse(port: number): Promise<boolean> {
  const { ok } = await pingService(port, 500);
  return ok;
}
