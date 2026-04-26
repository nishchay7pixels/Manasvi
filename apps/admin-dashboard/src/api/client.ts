/**
 * Manasvi Admin Dashboard — API Client
 *
 * All calls go through Vite's proxy (/api/<service>) → real service ports.
 * Every fetch gracefully returns null/[] on failure — the UI handles offline states.
 */

import type {
  ApprovalRequest,
  ApprovalAuditRecord,
  ExecutionRun,
  MemoryRecord,
  NodeRecord,
  PolicyDecision,
  PluginRecord,
  ServiceHealth,
  Session,
  SystemOverview,
  TelegramAdapterStatus,
  ToolEntry,
} from "./types.js";

// ── Fetch helper ──────────────────────────────────────────────────────────

async function get<T>(url: string, timeoutMs = 5000): Promise<T | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

async function post<T>(url: string, body: unknown, timeoutMs = 5000): Promise<T | null> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

// ── Service health ─────────────────────────────────────────────────────────

const SERVICES = [
  { name: "API Gateway",     port: 4100, path: "/api/gateway" },
  { name: "Ingress",         port: 4101, path: "/api/ingress" },
  { name: "Orchestrator",    port: 4102, path: "/api/orchestrator" },
  { name: "Policy",          port: 4103, path: "/api/policy" },
  { name: "Execution Mgr",   port: 4104, path: "/api/execution" },
  { name: "Memory",          port: 4105, path: "/api/memory" },
  { name: "Node Manager",    port: 4106, path: "/api/nodes" },
  { name: "Audit",           port: 4107, path: "/api/audit" },
  { name: "Approval",        port: 4108, path: "/api/approvals" },
];

export async function fetchServiceHealth(): Promise<ServiceHealth[]> {
  return Promise.all(
    SERVICES.map(async (svc) => {
      const info = await get<{ service?: string; plane?: string; serviceVersion?: string; environment?: string }>(
        svc.path + "/",
        3000
      );
      return {
        name: svc.name,
        port: svc.port,
        path: svc.path,
        online: info !== null,
        info: info ?? undefined,
      };
    })
  );
}

// ── Approvals ──────────────────────────────────────────────────────────────

interface ApprovalsResponse { requests?: ApprovalRequest[]; }
interface AuditRecordsResponse { records?: ApprovalAuditRecord[]; }

export async function fetchApprovalRequests(state?: string): Promise<ApprovalRequest[]> {
  const url = state
    ? `/api/approvals/approvals/requests?state=${state}`
    : `/api/approvals/approvals/requests`;
  const data = await get<ApprovalsResponse>(url);
  return data?.requests ?? [];
}

export async function fetchApprovalAuditRecords(): Promise<ApprovalAuditRecord[]> {
  const data = await get<AuditRecordsResponse>("/api/approvals/approvals/audit/records");
  return data?.records ?? [];
}

export async function submitApprovalDecision(
  requestId: string,
  decision: "approved" | "denied",
  reason?: string
): Promise<boolean> {
  const result = await post("/api/approvals/approvals/requests/decision", {
    requestId,
    decision,
    reason,
  });
  return result !== null;
}

// ── Sessions ───────────────────────────────────────────────────────────────

interface SessionsResponse { sessions?: Session[]; }

export async function fetchSessions(limit = 50): Promise<Session[]> {
  const data = await get<SessionsResponse>(
    `/api/orchestrator/orchestration/sessions?limit=${limit}`
  );
  return data?.sessions ?? [];
}

// ── Executions ─────────────────────────────────────────────────────────────

interface ExecutionsResponse { runs?: ExecutionRun[]; integrity?: ExecutionRun[]; }

export async function fetchExecutions(): Promise<ExecutionRun[]> {
  const data = await get<ExecutionsResponse>("/api/execution/execution/audit/integrity");
  return data?.runs ?? data?.integrity ?? [];
}

// ── Nodes ──────────────────────────────────────────────────────────────────

interface NodesResponse { nodes?: NodeRecord[]; }

export async function fetchNodes(): Promise<NodeRecord[]> {
  const data = await get<NodesResponse>("/api/nodes/nodes");
  return data?.nodes ?? [];
}

export async function quarantineNode(nodeId: string): Promise<boolean> {
  const r = await post(`/api/nodes/nodes/${nodeId}/quarantine`, {});
  return r !== null;
}

export async function revokeNode(nodeId: string): Promise<boolean> {
  const r = await post(`/api/nodes/nodes/${nodeId}/revoke`, {});
  return r !== null;
}

// ── Memory ─────────────────────────────────────────────────────────────────

interface MemoryResponse { records?: MemoryRecord[]; }

export async function fetchMemoryRecords(options: {
  memoryClass?: string;
  trustClass?: string;
  limit?: number;
} = {}): Promise<MemoryRecord[]> {
  const data = await post<MemoryResponse>("/api/memory/memory/query", {
    memoryClass: options.memoryClass,
    trustClass: options.trustClass,
    limit: options.limit ?? 100,
  });
  return data?.records ?? [];
}

export async function fetchMemoryClasses(): Promise<string[]> {
  const data = await get<{ classes?: string[] }>("/api/memory/memory/classes");
  return data?.classes ?? [];
}

// ── Policy ─────────────────────────────────────────────────────────────────

interface PolicyResponse { decisions?: PolicyDecision[]; }

export async function fetchPolicyDecisions(): Promise<PolicyDecision[]> {
  const data = await get<PolicyResponse>("/api/policy/policy/audit/decisions");
  return data?.decisions ?? [];
}

export interface PolicyMetadata {
  policySetId?: string;
  ruleCount?: number;
  loadedAt?: string;
  description?: string;
}

export async function fetchPolicyMetadata(): Promise<PolicyMetadata | null> {
  return get<PolicyMetadata>("/api/policy/policy/metadata");
}

// ── Tools ──────────────────────────────────────────────────────────────────

interface ToolsResponse { tools?: ToolEntry[]; }

export async function fetchTools(): Promise<ToolEntry[]> {
  const data = await post<ToolsResponse>("/api/orchestrator/tools/status", {});
  return data?.tools ?? [];
}

// ── Telegram / Ingress ─────────────────────────────────────────────────────

export async function fetchTelegramStatus(): Promise<TelegramAdapterStatus | null> {
  return get<TelegramAdapterStatus>("/api/ingress/ingress/telegram/status");
}

// ── Overview aggregate ─────────────────────────────────────────────────────

export async function fetchSystemOverview(): Promise<SystemOverview> {
  const [services, approvals, sessions, executions, policyDecisions, nodes, telegramStatus] =
    await Promise.all([
      fetchServiceHealth(),
      fetchApprovalRequests("pending"),
      fetchSessions(100),
      fetchExecutions(),
      fetchPolicyDecisions(),
      fetchNodes(),
      fetchTelegramStatus(),
    ]);

  const recentDenials = policyDecisions.filter(
    (d) => d.result === "deny" || d.result === "denied" as string
  ).length;

  return {
    services,
    pendingApprovals: approvals.length,
    activeSessions: sessions.filter(
      (s) => s.state === "active" || !s.state
    ).length,
    runningExecutions: executions.filter(
      (e) => e.status === "running" || e.status === "pending"
    ).length,
    recentDenials,
    nodeCount: nodes.length,
    healthyNodes: nodes.filter(
      (n) => n.state === "active"
    ).length,
    pluginCount: 0,
    telegramStatus,
  };
}

// ── Plugin registry (from extension-runtime if available) ─────────────────

interface PluginsResponse { plugins?: PluginRecord[]; }

export async function fetchPlugins(): Promise<PluginRecord[]> {
  // Extension runtime doesn't have a standard port yet — scaffold for future
  const data = await get<PluginsResponse>("/api/plugins/plugins");
  return data?.plugins ?? [];
}
