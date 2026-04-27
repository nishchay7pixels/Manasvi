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

// Raw shape from approval service
interface RawApprovalRequest {
  approvalRequestId?: string;
  requestId?: string;
  intentId?: string;
  tenantId?: string;
  workspaceId?: string;
  actor?: { principalId?: string; principalType?: string };
  actorPrincipalId?: string;
  target?: { resourceId?: string; resourceClass?: string };
  resource?: string;
  actionClass?: string;
  risk?: { score?: number; level?: string };
  riskLevel?: string;
  state?: string;
  summary?: string;
  contextSummary?: string;
  policyReason?: string;
  reason?: string;
  createdAt?: string;
  expiresAt?: string;
  decidedAt?: string;
  trace?: { traceId?: string };
  sessionId?: string;
}

function normalizeApprovalRequest(raw: RawApprovalRequest): ApprovalRequest {
  // Map "rejected" → "denied" for display consistency
  const rawState = raw.state ?? "pending";
  const state = rawState === "rejected" ? "denied" : rawState as ApprovalRequest["state"];

  return {
    requestId: raw.approvalRequestId ?? raw.requestId ?? crypto.randomUUID(),
    tenantId: raw.tenantId ?? "tenant-local",
    workspaceId: raw.workspaceId ?? "workspace-local",
    intentId: raw.intentId,
    actorPrincipalId: raw.actorPrincipalId ?? raw.actor?.principalId,
    actorPrincipalType: raw.actor?.principalType,
    tool: undefined,
    resource: raw.target?.resourceId ?? raw.target?.resourceClass ?? raw.resource,
    actionClass: raw.actionClass,
    riskLevel: (raw.risk?.level ?? raw.riskLevel) as ApprovalRequest["riskLevel"],
    state,
    reason: raw.policyReason ?? raw.reason,
    expiresAt: raw.expiresAt,
    createdAt: raw.createdAt ?? new Date().toISOString(),
    decidedAt: raw.decidedAt,
    contextSummary: raw.summary ?? raw.contextSummary,
  };
}

interface ApprovalsResponse { requests?: RawApprovalRequest[]; }
interface AuditRecordsResponse { records?: ApprovalAuditRecord[]; }

// Uses /admin/approvals — returns all requests without needing intentId
export async function fetchApprovalRequests(state?: string): Promise<ApprovalRequest[]> {
  const url = state
    ? `/api/approvals/admin/approvals?state=${state}`
    : `/api/approvals/admin/approvals`;
  const data = await get<ApprovalsResponse>(url);
  return (data?.requests ?? []).map(normalizeApprovalRequest);
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
    approvalRequestId: requestId,
    decision,
    reason,
  });
  return result !== null;
}

// ── Sessions ───────────────────────────────────────────────────────────────

interface RawSession {
  sessionId?: string;
  tenantId?: string;
  workspaceId?: string;
  status?: string;           // "active" | "closed" | ...
  state?: string;            // alias
  sessionType?: string;
  isolationMode?: string;
  owner?: { principalId?: string; principalType?: string };
  channelBinding?: { channelPrincipal?: { principalId?: string } };
  riskProfile?: { level?: string } | string;
  createdAt?: string;
  lastActivityAt?: string;
}

function normalizeSession(raw: RawSession): Session {
  const principalId = raw.owner?.principalId;
  const principalType = raw.owner?.principalType;
  const channelType = raw.channelBinding?.channelPrincipal?.principalId?.split(":")?.[0];
  const riskProfile =
    typeof raw.riskProfile === "object"
      ? (raw.riskProfile?.level as Session["riskProfile"])
      : (raw.riskProfile as Session["riskProfile"]);

  return {
    sessionId: raw.sessionId ?? crypto.randomUUID(),
    tenantId: raw.tenantId ?? "tenant-local",
    workspaceId: raw.workspaceId ?? "workspace-local",
    principalId,
    principalType,
    channelType,
    isolationMode: raw.isolationMode,
    state: raw.status ?? raw.state,
    riskProfile,
    createdAt: raw.createdAt ?? new Date().toISOString(),
    lastActivityAt: raw.lastActivityAt,
  };
}

interface SessionsResponse { sessions?: RawSession[]; }

// Uses /admin/sessions — returns all sessions without requiring a sessionId
export async function fetchSessions(limit = 50): Promise<Session[]> {
  const data = await get<SessionsResponse>(
    `/api/orchestrator/admin/sessions?limit=${limit}`
  );
  return (data?.sessions ?? []).map(normalizeSession);
}

// ── Executions ─────────────────────────────────────────────────────────────

interface ExecutionsResponse { events?: ExecutionRun[]; runs?: ExecutionRun[]; }

export async function fetchExecutions(): Promise<ExecutionRun[]> {
  const data = await get<ExecutionsResponse>("/api/execution/execution/audit/integrity");
  return data?.events ?? data?.runs ?? [];
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

// Uses /admin/memory — bypasses auth/policy, accessible from local dashboard
export async function fetchMemoryRecords(options: {
  memoryClass?: string;
  limit?: number;
} = {}): Promise<MemoryRecord[]> {
  const params = new URLSearchParams();
  if (options.memoryClass) params.set("memoryClass", options.memoryClass);
  if (options.limit) params.set("limit", String(options.limit));
  const qs = params.toString();
  const data = await get<MemoryResponse>(`/api/memory/admin/memory${qs ? `?${qs}` : ""}`);
  return data?.records ?? [];
}

export async function fetchMemoryClasses(): Promise<string[]> {
  const data = await get<{ classes?: string[] }>("/api/memory/memory/classes");
  return data?.classes ?? [];
}

// ── Policy ─────────────────────────────────────────────────────────────────

// Raw shape returned by the policy service audit endpoint
interface RawPolicyDecision {
  decisionId?: string;
  auditRecordId?: string;
  decision?: string;          // "ALLOW" | "DENY" | "APPROVAL_REQUIRED"
  result?: string;            // alternative field name (lowercase)
  timestamp?: string;
  createdAt?: string;
  actorPrincipal?: { principalId?: string } | string;
  actorPrincipalId?: string;
  actionClass?: string;
  actionId?: string;
  resourceClass?: string;
  resourceId?: string;
  matchedRuleId?: string;
  matchedPolicyId?: string;
  risk?: { score?: number; level?: string };
  riskScore?: number;
  trace?: { traceId?: string };
  traceId?: string;
  tenantId?: string;
  workspaceId?: string;
  reasonCodes?: string[];
  reason?: string;
  sessionId?: string;
}

interface PolicyResponse { decisions?: RawPolicyDecision[]; }

function normalizePolicyDecision(raw: RawPolicyDecision): PolicyDecision {
  // decision field: service uses uppercase "ALLOW"/"DENY"/"APPROVAL_REQUIRED"
  const rawResult = (raw.decision ?? raw.result ?? "allow").toLowerCase();
  const result =
    rawResult === "deny" ? "deny" :
    rawResult === "approval_required" ? "approval_required" :
    rawResult === "conditional_allow" ? "conditional_allow" :
    "allow";

  const actorPrincipalId =
    raw.actorPrincipalId ??
    (typeof raw.actorPrincipal === "object" ? raw.actorPrincipal?.principalId : raw.actorPrincipal);

  return {
    decisionId: raw.decisionId ?? raw.auditRecordId ?? crypto.randomUUID(),
    tenantId: raw.tenantId ?? "tenant-local",
    workspaceId: raw.workspaceId ?? "workspace-local",
    action: raw.actionId ?? raw.actionClass,
    resource: raw.resourceId ?? raw.resourceClass,
    actorPrincipalId,
    result: result as PolicyDecision["result"],
    matchedRuleId: raw.matchedRuleId ?? raw.matchedPolicyId,
    reason: raw.reason ?? raw.reasonCodes?.join(", "),
    riskScore: raw.risk?.score ?? raw.riskScore,
    traceId: raw.trace?.traceId ?? raw.traceId,
    sessionId: raw.sessionId,
    createdAt: raw.timestamp ?? raw.createdAt ?? new Date().toISOString(),
  };
}

export async function fetchPolicyDecisions(): Promise<PolicyDecision[]> {
  const data = await get<PolicyResponse>("/api/policy/policy/audit/decisions");
  return (data?.decisions ?? []).map(normalizePolicyDecision);
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

interface RawToolEntry {
  toolId?: string;
  version?: string;
  name?: string;
  description?: string;
  status?: string;
  actionClass?: string;
  sideEffectClass?: string;
  policyBinding?: { requiresApproval?: boolean; approvalSensitivity?: string };
  runtimeHints?: { approvalSensitivity?: string };
  tags?: string[];
  // stats if returned
  invocationCount?: number;
  lastInvokedAt?: string;
}

interface ToolsResponse { tools?: RawToolEntry[]; }

function normalizeTool(raw: RawToolEntry): ToolEntry {
  const sensitivity =
    raw.policyBinding?.approvalSensitivity ??
    raw.runtimeHints?.approvalSensitivity;
  return {
    toolId: raw.toolId ?? "unknown",
    name: raw.name ?? raw.toolId ?? "unknown",
    version: raw.version,
    status: (raw.status === "disabled" ? "disabled" : "enabled") as ToolEntry["status"],
    actionClass: raw.actionClass,
    sideEffectClass: raw.sideEffectClass,
    approvalSensitivity: sensitivity as ToolEntry["approvalSensitivity"],
    description: raw.description,
    invocationCount: raw.invocationCount,
    lastInvokedAt: raw.lastInvokedAt,
  };
}

// Uses /admin/tools — no auth required, lists all registered tools
export async function fetchTools(): Promise<ToolEntry[]> {
  const data = await get<ToolsResponse>("/api/orchestrator/admin/tools");
  return (data?.tools ?? []).map(normalizeTool);
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
    (d) => d.result === "deny"
  ).length;

  return {
    services,
    pendingApprovals: approvals.length,
    activeSessions: sessions.filter(
      (s) => s.state === "active" || s.state === "open" || !s.state
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
