/* ── Shared dashboard API types ──────────────────────────────────────────── */

// ── Service health ─────────────────────────────────────────────────────────

export interface ServiceInfo {
  service?: string;
  plane?: string;
  serviceVersion?: string;
  environment?: string;
}

export interface ServiceHealth {
  name: string;
  port: number;
  path: string;
  online: boolean;
  info?: ServiceInfo;
}

// ── Approvals ──────────────────────────────────────────────────────────────

export type ApprovalState =
  | "pending"
  | "approved"
  | "denied"
  | "expired"
  | "revoked";

export interface ApprovalRequest {
  requestId: string;
  tenantId: string;
  workspaceId: string;
  sessionId?: string;
  intentId?: string;
  actorPrincipalId?: string;
  actorPrincipalType?: string;
  tool?: string;
  resource?: string;
  actionClass?: string;
  sideEffectClass?: string;
  riskLevel?: "low" | "medium" | "high" | "critical";
  state: ApprovalState;
  reason?: string;
  decisionReason?: string;
  expiresAt?: string;
  createdAt: string;
  decidedAt?: string;
  contextSummary?: string;
}

export interface ApprovalAuditRecord {
  recordId: string;
  requestId: string;
  state: ApprovalState;
  actorId?: string;
  reason?: string;
  createdAt: string;
}

// ── Sessions ───────────────────────────────────────────────────────────────

export interface Session {
  sessionId: string;
  tenantId: string;
  workspaceId: string;
  principalId?: string;
  principalType?: string;
  channelType?: string;
  isolationMode?: string;
  state?: string;
  messageCount?: number;
  lastActivityAt?: string;
  createdAt: string;
  riskProfile?: "low" | "medium" | "high";
}

// ── Executions ─────────────────────────────────────────────────────────────

export type ExecutionStatus = "pending" | "running" | "completed" | "failed" | "timeout" | "cancelled";

export interface ExecutionRun {
  runId: string;
  tenantId: string;
  workspaceId: string;
  sessionId?: string;
  intentId?: string;
  tool?: string;
  actionClass?: string;
  sandboxMode?: string;
  nodeId?: string;
  status: ExecutionStatus;
  startedAt: string;
  completedAt?: string;
  exitCode?: number;
  errorMessage?: string;
  approvalId?: string;
}

// ── Nodes ──────────────────────────────────────────────────────────────────

export type NodeTrustClass = "trusted" | "semi_trusted" | "untrusted";
export type NodeState = "active" | "pairing" | "quarantined" | "revoked" | "offline" | string;

export interface NodeRecord {
  nodeId: string;
  nodeClass?: string;
  trustClass: NodeTrustClass;
  state: NodeState;
  capabilities?: string[];
  lastHeartbeatAt?: string;
  pairedAt?: string;
  dispatchCount?: number;
  failureCount?: number;
  metadata?: Record<string, unknown>;
}

// ── Memory ─────────────────────────────────────────────────────────────────

export type MemoryClass =
  | "ephemeral_session"
  | "user_persistent"
  | "shared_workspace"
  | "external_untrusted"
  | "audit_linked";

export type MemoryTrustClass = "trusted" | "semi_trusted" | "untrusted" | "external_untrusted";
export type PromotionState = "none" | "candidate" | "approved" | "rejected";

export interface MemoryRecord {
  recordId: string;
  tenantId: string;
  workspaceId: string;
  memoryClass: MemoryClass;
  namespace?: string;
  trustClass: MemoryTrustClass;
  sourcePrincipalId?: string;
  promotionState: PromotionState;
  contentSummary?: string;
  contentTokenCount?: number;
  createdAt: string;
  lastAccessedAt?: string;
  sessionId?: string;
}

// ── Policy ─────────────────────────────────────────────────────────────────

export type PolicyResult = "allow" | "deny" | "approval_required" | "conditional_allow";

export interface PolicyDecision {
  decisionId: string;
  tenantId: string;
  workspaceId: string;
  action?: string;
  resource?: string;
  actorPrincipalId?: string;
  result: PolicyResult;
  matchedRuleId?: string;
  reason?: string;
  riskScore?: number;
  traceId?: string;
  sessionId?: string;
  createdAt: string;
}

// ── Audit ──────────────────────────────────────────────────────────────────

export interface AuditEvent {
  eventId: string;
  eventType: string;
  service?: string;
  tenantId?: string;
  workspaceId?: string;
  principalId?: string;
  sessionId?: string;
  traceId?: string;
  correlationId?: string;
  severity?: "info" | "warn" | "error" | "critical";
  summary?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

// ── Plugins ────────────────────────────────────────────────────────────────

export type PluginState = "enabled" | "disabled" | "quarantined" | "revoked";
export type PluginRiskClass = "low" | "medium" | "high" | "critical";

export interface PluginRecord {
  pluginId: string;
  name: string;
  version?: string;
  publisher?: string;
  state: PluginState;
  riskClass: PluginRiskClass;
  requestedCapabilities?: string[];
  grantedCapabilities?: string[];
  lastUsedAt?: string;
  installDate?: string;
  description?: string;
}

// ── Tools ──────────────────────────────────────────────────────────────────

export interface ToolEntry {
  toolId: string;
  name: string;
  version?: string;
  status: "enabled" | "disabled";
  actionClass?: string;
  sideEffectClass?: string;
  approvalSensitivity?: "none" | "low" | "medium" | "high" | "always";
  description?: string;
  invocationCount?: number;
  lastInvokedAt?: string;
}

// ── Telegram / Channel ─────────────────────────────────────────────────────

export interface TelegramPollerStatus {
  running: boolean;
  offset: number;
  updatesReceived: number;
  lastPollAt: string | null;
  lastUpdateAt: string | null;
  lastError: string | null;
  consecutiveErrors: number;
  mode: "polling";
}

export interface TelegramAdapterStatus {
  configured: boolean;
  mode?: "polling" | "webhook" | "disabled";
  poller?: TelegramPollerStatus | null;
}

// ── Overview aggregate ─────────────────────────────────────────────────────

export interface SystemOverview {
  services: ServiceHealth[];
  pendingApprovals: number;
  activeSessions: number;
  runningExecutions: number;
  recentDenials: number;
  nodeCount: number;
  healthyNodes: number;
  pluginCount: number;
  telegramStatus: TelegramAdapterStatus | null;
}

export interface IntegrationAccount {
  accountId: string;
  providerId: string;
  status: string;
  scopesGranted: string[];
  tokenExpiresAt: string | null;
  lastAuthAt: string | null;
  lastRefreshAt: string | null;
  lastError: string | null;
}

export interface GoogleAuthorizationSnapshot {
  connected: boolean;
  status: string;
  normalizedScopes: string[];
  availableCapabilities: Array<{
    capabilityId: string;
    serviceFamily: string;
    class: string;
    approvalSensitivity: string;
  }>;
  actions: Array<{
    actionId: string;
    serviceFamily: string;
    class: string;
    approvalSensitivity: string;
    canAttempt: boolean;
    missingCapabilities: string[];
  }>;
}

export interface GmailHealthStatus {
  status: string;
  connected: boolean;
  gmailReadAuthorized: boolean;
  availableCapabilities: string[];
  missingCapabilities: string[];
  tokenPresent: boolean;
  lastSuccessfulReadAt: string | null;
  lastError: string | null;
}

export interface CalendarHealthStatus {
  status: string;
  connected: boolean;
  calendarReadAuthorized: boolean;
  availableCapabilities: string[];
  missingCapabilities: string[];
  tokenPresent: boolean;
  lastSuccessfulReadAt: string | null;
  lastError: string | null;
}

export interface CalendarEventSummary {
  eventId: string;
  calendarId: string;
  title: string;
  description: string | null;
  location: string | null;
  startIso: string;
  endIso: string;
  allDay: boolean;
  timezone: string | null;
  status: string | null;
  attendeeCount: number;
  hasAttendees: boolean;
  organizerEmail: string | null;
  hasMeetingLink: boolean;
  isRecurring: boolean;
}

export interface CalendarUpcomingResult {
  calendarId: string;
  fetchedAt: string;
  timezone: string | null;
  events: CalendarEventSummary[];
  totalCount: number;
  hasMore: boolean;
}
