import { useState } from "react";
import { useApi } from "../hooks/useApi.js";
import { fetchPolicyDecisions } from "../api/client.js";
import {
  StatusBadge, TimeAgo, CopyId,
  EmptyState, JsonViewer
} from "../components/ui/primitives.js";
import "./traces.css";

// ── Trace hop ─────────────────────────────────────────────────────────────

interface TraceHop {
  service: string;
  event: string;
  detail: string;
  status: "ok" | "warn" | "error" | "info";
  time?: string;
  data?: unknown;
}

function TraceHopRow({ hop, index }: { hop: TraceHop; index: number }) {
  const [expanded, setExpanded] = useState(false);
  const colors = { ok: "var(--success)", warn: "var(--amber)", error: "var(--error)", info: "var(--cyan)" };

  return (
    <div className="trace-hop">
      <div className="trace-hop__connector">
        <div className="trace-hop__index" style={{ borderColor: colors[hop.status], color: colors[hop.status] }}>
          {index + 1}
        </div>
        <div className="trace-hop__line" />
      </div>
      <div className="trace-hop__body">
        <div className="trace-hop__header" onClick={() => hop.data != null && setExpanded(!expanded)}>
          <span className="trace-hop__service">{hop.service}</span>
          <span className="trace-hop__event">{hop.event}</span>
          <span className="trace-hop__detail">{hop.detail}</span>
          {hop.time && <TimeAgo iso={hop.time} />}
          {hop.data != null && (
            <button className="trace-hop__expand">
              {expanded ? "▲" : "▼"}
            </button>
          )}
        </div>
        {expanded && hop.data != null && (
          <div className="trace-hop__data">
            <JsonViewer data={hop.data} maxHeight={200} />
          </div>
        )}
      </div>
    </div>
  );
}

// ── Build a synthetic trace from policy decision ──────────────────────────

function buildTrace(decision: {
  decisionId: string;
  traceId?: string;
  action?: string;
  resource?: string;
  result: string;
  actorPrincipalId?: string;
  sessionId?: string;
  createdAt: string;
  matchedRuleId?: string;
  reason?: string;
  riskScore?: number;
}): TraceHop[] {
  const hops: TraceHop[] = [
    {
      service: "Ingress",
      event: "Message received",
      detail: "Inbound message normalized and edge controls evaluated",
      status: "ok",
      time: decision.createdAt,
    },
    {
      service: "Orchestrator",
      event: "Context assembled",
      detail: `Session resolved · Principal: ${decision.actorPrincipalId ?? "anonymous"}`,
      status: "ok",
      time: decision.createdAt,
    },
    {
      service: "Orchestrator",
      event: "Planner proposed action",
      detail: `Action: ${decision.action ?? "tool invocation"} on ${decision.resource ?? "resource"}`,
      status: "ok",
      time: decision.createdAt,
    },
    {
      service: "Policy",
      event: "Policy evaluated",
      detail: `Result: ${decision.result}${decision.matchedRuleId ? ` · Rule: ${decision.matchedRuleId}` : ""}${decision.riskScore != null ? ` · Risk: ${decision.riskScore}` : ""}`,
      status:
        decision.result === "deny" ? "error" :
        decision.result === "approval_required" ? "warn" : "ok",
      time: decision.createdAt,
      data: { result: decision.result, matchedRule: decision.matchedRuleId, reason: decision.reason },
    },
  ];

  if (decision.result === "approval_required") {
    hops.push({
      service: "Approval",
      event: "Approval requested",
      detail: "Waiting for human review",
      status: "warn",
      time: decision.createdAt,
    });
  } else if (decision.result === "allow") {
    hops.push({
      service: "Execution",
      event: "Tool dispatched",
      detail: "Sandboxed execution initiated",
      status: "ok",
      time: decision.createdAt,
    });
  }

  return hops;
}

// ── Traces page ───────────────────────────────────────────────────────────

export function Traces() {
  const [searchId, setSearchId] = useState("");
  const [selectedDecisionId, setSelectedDecisionId] = useState<string | null>(null);

  const { data: decisions, loading } = useApi(fetchPolicyDecisions);

  const filtered = (decisions ?? []).filter((d) => {
    if (!searchId) return true;
    const q = searchId.toLowerCase();
    return (
      d.decisionId.includes(q) ||
      (d.traceId ?? "").includes(q) ||
      (d.sessionId ?? "").includes(q) ||
      (d.actorPrincipalId ?? "").includes(q)
    );
  });

  const selected = decisions?.find((d) => d.decisionId === selectedDecisionId);
  const traceHops = selected ? buildTrace(selected) : null;

  return (
    <div className="page traces-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Trace Explorer</h1>
          <p className="page-subtitle">Search and visualize cross-service decision chains — "why did Manasvi do this?"</p>
        </div>
      </div>

      {/* Search bar */}
      <div className="trace-search">
        <span className="trace-search__icon">⊹</span>
        <input
          className="trace-search__input"
          placeholder="Search by trace ID, session ID, principal, or intent ID…"
          value={searchId}
          onChange={(e) => setSearchId(e.target.value)}
        />
        {searchId && (
          <button className="trace-search__clear" onClick={() => setSearchId("")}>✕</button>
        )}
      </div>

      <div className="traces-layout">
        {/* List */}
        <div className="traces-list">
          <div className="traces-list__header">
            Policy Decisions <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>({filtered.length})</span>
          </div>
          {loading && !decisions && (
            <div style={{ padding: 24, textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>Loading…</div>
          )}
          {!loading && filtered.length === 0 && (
            <div style={{ padding: 24, textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>No matching records</div>
          )}
          {filtered.map((d) => (
            <button
              key={d.decisionId}
              className={`trace-list-item${selectedDecisionId === d.decisionId ? " trace-list-item--active" : ""}`}
              onClick={() => setSelectedDecisionId(d.decisionId)}
            >
              <div className="trace-list-item__top">
                <StatusBadge status={d.result} label={d.result.replace("_", " ")} />
                <TimeAgo iso={d.createdAt} />
              </div>
              <div className="trace-list-item__action">
                {d.action ?? "unknown action"}
              </div>
              {d.traceId && (
                <div className="trace-list-item__id">
                  trace: {d.traceId.slice(0, 16)}…
                </div>
              )}
            </button>
          ))}
        </div>

        {/* Trace chain */}
        <div className="trace-chain">
          {!selected && (
            <EmptyState
              icon="⊹"
              title="Select a record to trace"
              description="Click any policy decision to see the full cross-service execution chain."
            />
          )}
          {selected && traceHops && (
            <div className="trace-chain__inner">
              <div className="trace-chain__header">
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>
                    {selected.action ?? "Policy decision"} → {selected.resource ?? "resource"}
                  </div>
                  {selected.traceId && <CopyId id={selected.traceId} maxLen={20} />}
                </div>
                <StatusBadge status={selected.result} label={selected.result.replace("_", " ")} />
              </div>
              <div className="trace-hops">
                {traceHops.map((hop, i) => (
                  <TraceHopRow key={i} hop={hop} index={i} />
                ))}
              </div>
              <div style={{ padding: "16px 20px", borderTop: "1px solid var(--border)" }}>
                <JsonViewer data={selected} maxHeight={180} />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
