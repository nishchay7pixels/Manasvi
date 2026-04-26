import { usePolling } from "../hooks/useApi.js";
import { fetchPolicyDecisions, fetchApprovalRequests, fetchNodes } from "../api/client.js";
import {
  Card, CardHeader, Badge, StatusBadge, TimeAgo, CopyId, EmptyState
} from "../components/ui/primitives.js";
import "./risk.css";

export function Risk() {
  const { data: decisions } = usePolling(fetchPolicyDecisions, 15_000);
  const { data: pendingApprovals } = usePolling(() => fetchApprovalRequests("pending"), 10_000);
  const { data: nodes } = usePolling(fetchNodes, 20_000);

  const denials = (decisions ?? []).filter((d) => d.result === "deny");
  const highRiskApprovals = (pendingApprovals ?? []).filter(
    (a) => a.riskLevel === "high" || a.riskLevel === "critical"
  );
  const quarantinedNodes = (nodes ?? []).filter(
    (n) => n.state === "quarantined" || n.state === "revoked"
  );

  const riskScore = Math.min(
    100,
    denials.length * 5 + highRiskApprovals.length * 20 + quarantinedNodes.length * 15
  );

  const riskLevel = riskScore === 0 ? "low" : riskScore < 30 ? "medium" : "high";
  const riskColor = riskScore === 0 ? "var(--success)" : riskScore < 30 ? "var(--warning)" : "var(--error)";

  return (
    <div className="page risk-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Risk Dashboard</h1>
          <p className="page-subtitle">Active security signals, governance anomalies, and risk indicators</p>
        </div>
        <StatusBadge status={riskLevel} label={`${riskLevel.toUpperCase()} RISK`} />
      </div>

      {/* Risk score */}
      <Card className="risk-score-card">
        <div className="risk-score">
          <div className="risk-score__gauge">
            <svg viewBox="0 0 120 70" width="200">
              <path
                d="M 10 65 A 55 55 0 0 1 110 65"
                fill="none"
                stroke="var(--bg-elevated)"
                strokeWidth="10"
                strokeLinecap="round"
              />
              <path
                d="M 10 65 A 55 55 0 0 1 110 65"
                fill="none"
                stroke={riskColor}
                strokeWidth="10"
                strokeLinecap="round"
                strokeDasharray={`${(riskScore / 100) * 172} 172`}
                style={{ transition: "stroke-dasharray 0.6s ease" }}
              />
            </svg>
            <div className="risk-score__value" style={{ color: riskColor }}>
              {riskScore}
            </div>
          </div>
          <div className="risk-score__label">Risk Score</div>
          <div className="risk-score__desc">Composite risk based on denials, approvals, node health</div>
        </div>
        <div className="risk-score__breakdown">
          <div className="risk-score__item">
            <span>Policy denials</span>
            <span style={{ color: denials.length > 0 ? "var(--error)" : "var(--text-muted)" }}>
              {denials.length}
            </span>
          </div>
          <div className="risk-score__item">
            <span>High-risk approvals</span>
            <span style={{ color: highRiskApprovals.length > 0 ? "var(--amber)" : "var(--text-muted)" }}>
              {highRiskApprovals.length}
            </span>
          </div>
          <div className="risk-score__item">
            <span>Quarantined nodes</span>
            <span style={{ color: quarantinedNodes.length > 0 ? "var(--error)" : "var(--text-muted)" }}>
              {quarantinedNodes.length}
            </span>
          </div>
        </div>
      </Card>

      <div className="grid-2">
        {/* Recent denials */}
        <Card>
          <CardHeader
            title="Recent Policy Denials"
            icon="⊟"
            actions={denials.length > 0 ? <Badge variant="error">{denials.length}</Badge> : undefined}
          />
          {denials.length === 0 ? (
            <EmptyState icon="✓" title="No denials" description="No policy rejections found." />
          ) : (
            <div className="risk-list">
              {denials.slice(0, 8).map((d) => (
                <div key={d.decisionId} className="risk-list__item">
                  <div className="risk-list__item-top">
                    <code style={{ fontSize: 12, color: "var(--error)" }}>{d.action ?? "unknown"}</code>
                    <TimeAgo iso={d.createdAt} />
                  </div>
                  <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                    {d.reason ?? d.resource ?? "No detail available"}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* High-risk pending approvals */}
        <Card>
          <CardHeader
            title="High-Risk Pending Approvals"
            icon="⊘"
            actions={highRiskApprovals.length > 0 ? <Badge variant="amber">{highRiskApprovals.length}</Badge> : undefined}
          />
          {highRiskApprovals.length === 0 ? (
            <EmptyState icon="✓" title="None pending" description="No high-risk approvals awaiting review." />
          ) : (
            <div className="risk-list">
              {highRiskApprovals.map((a) => (
                <div key={a.requestId} className="risk-list__item">
                  <div className="risk-list__item-top">
                    <CopyId id={a.requestId} />
                    <Badge variant={a.riskLevel === "critical" ? "error" : "warning"}>
                      {a.riskLevel}
                    </Badge>
                  </div>
                  <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                    {a.tool ?? a.actionClass ?? "unknown action"} · <TimeAgo iso={a.createdAt} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Quarantined nodes */}
        <Card>
          <CardHeader
            title="Quarantined / Revoked Nodes"
            icon="⊛"
            actions={quarantinedNodes.length > 0 ? <Badge variant="error">{quarantinedNodes.length}</Badge> : undefined}
          />
          {quarantinedNodes.length === 0 ? (
            <EmptyState icon="✓" title="All nodes healthy" description="No nodes are quarantined or revoked." />
          ) : (
            <div className="risk-list">
              {quarantinedNodes.map((n) => (
                <div key={n.nodeId} className="risk-list__item">
                  <div className="risk-list__item-top">
                    <CopyId id={n.nodeId} />
                    <StatusBadge status={n.state} />
                  </div>
                  <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                    Trust: {n.trustClass} · Class: {n.nodeClass ?? "—"}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Risk summary */}
        <Card>
          <CardHeader title="Risk Indicators" icon="⚑" />
          <div className="risk-indicators">
            {[
              { label: "Policy denials in window", value: denials.length, threshold: 5, unit: "" },
              { label: "Pending high-risk approvals", value: highRiskApprovals.length, threshold: 2, unit: "" },
              { label: "Quarantined nodes", value: quarantinedNodes.length, threshold: 1, unit: "" },
            ].map((ind) => {
              const isAlert = ind.value >= ind.threshold;
              return (
                <div key={ind.label} className="risk-indicator">
                  <div className="risk-indicator__label">{ind.label}</div>
                  <div
                    className="risk-indicator__bar-track"
                  >
                    <div
                      className="risk-indicator__bar"
                      style={{
                        width: `${Math.min(100, (ind.value / Math.max(ind.threshold * 2, 1)) * 100)}%`,
                        background: isAlert ? "var(--error)" : "var(--success)",
                      }}
                    />
                  </div>
                  <span
                    style={{
                      color: isAlert ? "var(--error)" : "var(--text-muted)",
                      fontFamily: "var(--font-mono)",
                      fontSize: 12,
                      minWidth: 24,
                      textAlign: "right",
                    }}
                  >
                    {ind.value}
                  </span>
                </div>
              );
            })}
          </div>
        </Card>
      </div>
    </div>
  );
}
