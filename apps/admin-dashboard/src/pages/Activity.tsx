import { useState } from "react";
import { usePolling } from "../hooks/useApi.js";
import { fetchApprovalAuditRecords, fetchPolicyDecisions } from "../api/client.js";
import { Card, Badge, StatusBadge, TimeAgo, CopyId, EmptyState, LoadingState } from "../components/ui/primitives.js";
import { FilterBar, FilterInput, FilterSelect } from "../components/ui/Table.js";
import type { ApprovalAuditRecord, PolicyDecision } from "../api/types.js";
import "./activity.css";

// ── Activity event union ──────────────────────────────────────────────────

type EventSource = "approval" | "policy" | "system";

interface ActivityEvent {
  id: string;
  type: string;
  source: EventSource;
  severity: "info" | "warn" | "error";
  summary: string;
  traceId?: string;
  sessionId?: string;
  principalId?: string;
  createdAt: string;
}

function approvalToEvent(r: ApprovalAuditRecord): ActivityEvent {
  const isDecision = r.state !== "pending";
  const severity = r.state === "denied" || r.state === "revoked" ? "error" : "info";
  return {
    id: `approval-${r.recordId}`,
    type: isDecision ? `Approval ${r.state}` : "Approval created",
    source: "approval",
    severity,
    summary: r.reason
      ? `${r.state}: ${r.reason}`
      : `Approval request ${r.state}`,
    createdAt: r.createdAt,
  };
}

function policyToEvent(d: PolicyDecision): ActivityEvent {
  const severity =
    d.result === "deny" ? "error" :
    d.result === "approval_required" ? "warn" : "info";
  return {
    id: `policy-${d.decisionId}`,
    type: `Policy ${d.result.replace("_", " ")}`,
    source: "policy",
    severity,
    summary: `${d.action ?? "action"} on ${d.resource ?? "resource"} — ${d.result}`,
    traceId: d.traceId,
    sessionId: d.sessionId,
    principalId: d.actorPrincipalId,
    createdAt: d.createdAt,
  };
}

// ── Event row ─────────────────────────────────────────────────────────────

function EventRow({ event }: { event: ActivityEvent }) {
  const sourceColor: Record<EventSource, string> = {
    approval: "var(--amber)",
    policy: "var(--violet)",
    system: "var(--cyan)",
  };

  const sourceBadge: Record<EventSource, "amber" | "violet" | "cyan"> = {
    approval: "amber",
    policy: "violet",
    system: "cyan",
  };

  return (
    <div className={`event-row event-row--${event.severity}`}>
      <div className="event-row__accent" style={{ background: sourceColor[event.source] }} />
      <div className="event-row__body">
        <div className="event-row__top">
          <Badge variant={sourceBadge[event.source]}>{event.source}</Badge>
          <span className="event-row__type">{event.type}</span>
          <StatusBadge status={event.severity === "error" ? "error" : event.severity === "warn" ? "warning" : "info"} label={event.severity} />
          <span style={{ flex: 1 }} />
          <TimeAgo iso={event.createdAt} />
        </div>
        <div className="event-row__summary">{event.summary}</div>
        <div className="event-row__meta">
          {event.traceId && (
            <span className="event-row__meta-item">trace <CopyId id={event.traceId} /></span>
          )}
          {event.sessionId && (
            <span className="event-row__meta-item">session <CopyId id={event.sessionId} /></span>
          )}
          {event.principalId && (
            <span className="event-row__meta-item">principal <CopyId id={event.principalId} /></span>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Activity page ─────────────────────────────────────────────────────────

export function Activity() {
  const [search, setSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [severityFilter, setSeverityFilter] = useState("all");

  const { data: approvalRecords, loading: aLoading } = usePolling(
    fetchApprovalAuditRecords, 8_000
  );
  const { data: policyDecisions, loading: pLoading } = usePolling(
    fetchPolicyDecisions, 8_000
  );

  const loading = aLoading && pLoading && !approvalRecords && !policyDecisions;

  const events: ActivityEvent[] = [
    ...(approvalRecords ?? []).map(approvalToEvent),
    ...(policyDecisions ?? []).map(policyToEvent),
  ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const filtered = events.filter((e) => {
    if (sourceFilter !== "all" && e.source !== sourceFilter) return false;
    if (severityFilter !== "all" && e.severity !== severityFilter) return false;
    if (search && !JSON.stringify(e).toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="page activity-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Live Activity</h1>
          <p className="page-subtitle">Real-time event stream — approvals, policy decisions, system events</p>
        </div>
        <div className="activity-refresh">
          <span className="activity-refresh__dot" />
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Polling every 8s</span>
        </div>
      </div>

      <FilterBar>
        <FilterInput placeholder="Search events…" value={search} onChange={setSearch} />
        <FilterSelect
          label="Source"
          value={sourceFilter}
          onChange={setSourceFilter}
          options={[
            { value: "all", label: "All sources" },
            { value: "approval", label: "Approvals" },
            { value: "policy", label: "Policy" },
            { value: "system", label: "System" },
          ]}
        />
        <FilterSelect
          label="Severity"
          value={severityFilter}
          onChange={setSeverityFilter}
          options={[
            { value: "all", label: "All severities" },
            { value: "error", label: "Error" },
            { value: "warn", label: "Warning" },
            { value: "info", label: "Info" },
          ]}
        />
        <span style={{ fontSize: 12, color: "var(--text-muted)", marginLeft: "auto" }}>
          {filtered.length} event{filtered.length !== 1 ? "s" : ""}
        </span>
      </FilterBar>

      <Card className="activity-stream-card">
        {loading && <LoadingState label="Loading activity stream…" />}
        {!loading && filtered.length === 0 && (
          <EmptyState
            icon="◎"
            title="No activity yet"
            description="Events from approvals, policy decisions, and system changes appear here as services run."
          />
        )}
        {!loading && filtered.length > 0 && (
          <div className="event-stream">
            {filtered.map((e) => (
              <EventRow key={e.id} event={e} />
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
