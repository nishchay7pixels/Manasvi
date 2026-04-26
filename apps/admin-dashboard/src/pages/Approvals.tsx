import { useState } from "react";
import { usePolling, useApi } from "../hooks/useApi.js";
import { fetchApprovalRequests, submitApprovalDecision } from "../api/client.js";
import {
  Badge, StatusBadge, TimeAgo, CopyId,
  EmptyState, LoadingState, Button, JsonViewer
} from "../components/ui/primitives.js";
import { Table } from "../components/ui/Table.js";
import type { ApprovalRequest } from "../api/types.js";
import "./approvals.css";

// ── Approval detail drawer ────────────────────────────────────────────────

function ApprovalDrawer({
  request,
  onClose,
  onDecision,
}: {
  request: ApprovalRequest;
  onClose: () => void;
  onDecision: (id: string, decision: "approved" | "denied", reason?: string) => void;
}) {
  const [reason, setReason] = useState("");
  const [acting, setActing] = useState(false);

  const act = async (decision: "approved" | "denied") => {
    setActing(true);
    await onDecision(request.requestId, decision, reason || undefined);
    setActing(false);
    onClose();
  };

  const riskColor: Record<string, string> = {
    low: "var(--success)",
    medium: "var(--warning)",
    high: "var(--error)",
    critical: "var(--error)",
  };

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <div className="drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer__header">
          <div>
            <div className="drawer__title">Approval Request</div>
            <CopyId id={request.requestId} maxLen={20} />
          </div>
          <button className="drawer__close" onClick={onClose}>✕</button>
        </div>

        <div className="drawer__body">
          {/* State + risk */}
          <div className="drawer__row">
            <StatusBadge status={request.state} />
            {request.riskLevel && (
              <span className="drawer__risk" style={{ color: riskColor[request.riskLevel] ?? "var(--text-muted)" }}>
                ⚑ {request.riskLevel} risk
              </span>
            )}
          </div>

          {/* Intent summary */}
          {request.contextSummary && (
            <div className="drawer__section">
              <div className="drawer__section-title">What is being approved</div>
              <div className="drawer__summary">{request.contextSummary}</div>
            </div>
          )}

          {/* Details grid */}
          <div className="drawer__section">
            <div className="drawer__section-title">Details</div>
            <div className="drawer__detail-grid">
              {request.tool && <><span>Tool</span><code>{request.tool}</code></>}
              {request.resource && <><span>Resource</span><code>{request.resource}</code></>}
              {request.actionClass && <><span>Action class</span><code>{request.actionClass}</code></>}
              {request.sideEffectClass && <><span>Side effects</span><code>{request.sideEffectClass}</code></>}
              {request.actorPrincipalId && <><span>Actor</span><CopyId id={request.actorPrincipalId} /></>}
              {request.sessionId && <><span>Session</span><CopyId id={request.sessionId} /></>}
              {request.intentId && <><span>Intent</span><CopyId id={request.intentId} /></>}
              <span>Created</span>
              <span><TimeAgo iso={request.createdAt} /></span>
              {request.expiresAt && (
                <><span>Expires</span><TimeAgo iso={request.expiresAt} /></>
              )}
            </div>
          </div>

          {/* Raw JSON */}
          <div className="drawer__section">
            <div className="drawer__section-title">Full request payload</div>
            <JsonViewer data={request} maxHeight={180} />
          </div>

          {/* Decision panel */}
          {request.state === "pending" && (
            <div className="drawer__decision">
              <div className="drawer__section-title">Decision</div>
              <textarea
                className="drawer__reason"
                placeholder="Optional reason for your decision…"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={2}
              />
              <div className="drawer__decision-actions">
                <Button
                  variant="danger"
                  onClick={() => void act("denied")}
                  disabled={acting}
                >
                  ✕ Deny
                </Button>
                <Button
                  variant="success"
                  onClick={() => void act("approved")}
                  disabled={acting}
                >
                  ✓ Approve
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Approvals page ────────────────────────────────────────────────────────

export function Approvals() {
  const [tab, setTab] = useState<"pending" | "all">("pending");
  const [selected, setSelected] = useState<ApprovalRequest | null>(null);

  const { data: pending, loading: pLoading, refresh: refreshPending } = usePolling(
    () => fetchApprovalRequests("pending"), 10_000
  );
  const { data: all, loading: aLoading, refresh: refreshAll } = useApi(
    () => fetchApprovalRequests()
  );

  const rows = tab === "pending" ? (pending ?? []) : (all ?? []);
  const loading = tab === "pending" ? (pLoading && !pending) : (aLoading && !all);

  const handleDecision = async (id: string, decision: "approved" | "denied", reason?: string) => {
    await submitApprovalDecision(id, decision, reason);
    refreshPending();
    refreshAll();
  };

  const riskBadge = (level?: string) => {
    if (!level) return null;
    const v = { low: "success", medium: "warning", high: "error", critical: "error" } as const;
    return <StatusBadge status={v[level as keyof typeof v] ?? "dim"} label={level} />;
  };

  return (
    <div className="page approvals-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Approvals Center</h1>
          <p className="page-subtitle">Review and action pending approval requests</p>
        </div>
        {(pending?.length ?? 0) > 0 && (
          <Badge variant="amber" dot>{pending!.length} pending</Badge>
        )}
      </div>

      {/* Tabs */}
      <div className="approvals-tabs">
        <button
          className={`approvals-tab${tab === "pending" ? " approvals-tab--active" : ""}`}
          onClick={() => setTab("pending")}
        >
          Pending
          {(pending?.length ?? 0) > 0 && (
            <span className="approvals-tab__count">{pending!.length}</span>
          )}
        </button>
        <button
          className={`approvals-tab${tab === "all" ? " approvals-tab--active" : ""}`}
          onClick={() => setTab("all")}
        >
          All requests
        </button>
      </div>

      {loading && <LoadingState label="Loading approval requests…" />}

      {!loading && rows.length === 0 && (
        <EmptyState
          icon="⊘"
          title={tab === "pending" ? "No pending approvals" : "No approval requests"}
          description={tab === "pending" ? "All caught up — no requests awaiting review." : "Approval requests appear here as Manasvi requests human review."}
        />
      )}

      {!loading && rows.length > 0 && (
        <Table
          columns={[
            {
              key: "id",
              header: "Request ID",
              width: "160px",
              render: (r) => <CopyId id={r.requestId} maxLen={14} />,
            },
            {
              key: "tool",
              header: "Tool / Action",
              render: (r) => (
                <div>
                  {r.tool ? <code style={{ fontSize: 12 }}>{r.tool}</code> : <span style={{ color: "var(--text-muted)" }}>—</span>}
                  {r.actionClass && <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>{r.actionClass}</div>}
                </div>
              ),
            },
            {
              key: "risk",
              header: "Risk",
              width: "90px",
              render: (r) => riskBadge(r.riskLevel) ?? <span style={{ color: "var(--text-muted)" }}>—</span>,
            },
            {
              key: "state",
              header: "State",
              width: "110px",
              render: (r) => <StatusBadge status={r.state} />,
            },
            {
              key: "actor",
              header: "Actor",
              width: "130px",
              render: (r) => r.actorPrincipalId ? <CopyId id={r.actorPrincipalId} /> : <span style={{ color: "var(--text-muted)" }}>—</span>,
            },
            {
              key: "created",
              header: "Created",
              width: "100px",
              render: (r) => <TimeAgo iso={r.createdAt} />,
            },
          ]}
          rows={rows}
          rowKey={(r) => r.requestId}
          onRowClick={setSelected}
        />
      )}

      {selected && (
        <ApprovalDrawer
          request={selected}
          onClose={() => setSelected(null)}
          onDecision={handleDecision}
        />
      )}
    </div>
  );
}
