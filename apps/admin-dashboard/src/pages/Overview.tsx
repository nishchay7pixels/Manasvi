import { useNavigate } from "react-router-dom";
import { usePolling } from "../hooks/useApi.js";
import { fetchSystemOverview } from "../api/client.js";
import {
  Card, CardHeader, MetricCard, Badge, StatusBadge,
  StatusDot, LoadingState, EmptyState, Button
} from "../components/ui/primitives.js";
import type { ServiceHealth, SystemOverview } from "../api/types.js";
import "./overview.css";

// ── Service health grid ───────────────────────────────────────────────────

function ServiceHealthGrid({ services }: { services: ServiceHealth[] }) {
  return (
    <div className="service-grid">
      {services.map((svc) => (
        <div key={svc.name} className={`service-tile ${svc.online ? "service-tile--online" : "service-tile--offline"}`}>
          <StatusDot status={svc.online ? "online" : "offline"} size={7} />
          <span className="service-tile__name">{svc.name}</span>
          <span className="service-tile__port">:{svc.port}</span>
        </div>
      ))}
    </div>
  );
}

// ── Quick action button ───────────────────────────────────────────────────

function QuickAction({
  label,
  icon,
  to,
  accent,
}: {
  label: string;
  icon: string;
  to: string;
  accent?: "amber" | "cyan" | "violet";
}) {
  const navigate = useNavigate();
  return (
    <button
      className={`quick-action${accent ? ` quick-action--${accent}` : ""}`}
      onClick={() => navigate(to)}
    >
      <span className="quick-action__icon">{icon}</span>
      <span className="quick-action__label">{label}</span>
    </button>
  );
}

// ── Overview page ─────────────────────────────────────────────────────────

export function Overview() {
  const navigate = useNavigate();
  const { data, loading } = usePolling<SystemOverview>(fetchSystemOverview, 15_000);

  const onlineCount = data?.services.filter((s) => s.online).length ?? 0;
  const totalCount = data?.services.length ?? 0;

  return (
    <div className="page overview-page">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Control Room</h1>
          <p className="page-subtitle">System status, active governance, and live operations</p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Button variant="ghost" size="sm" onClick={() => navigate("/traces")}>⊹ Open Trace Explorer</Button>
          <Button variant="primary" size="sm" onClick={() => navigate("/approvals")}>⊘ Review Approvals</Button>
        </div>
      </div>

      {loading && !data && <LoadingState label="Loading system overview…" />}

      {data && (
        <>
          {/* Metrics row */}
          <div className="grid-4">
            <MetricCard
              label="Pending Approvals"
              value={data.pendingApprovals}
              accent={data.pendingApprovals > 0 ? "amber" : undefined}
              icon="⊘"
              sub={data.pendingApprovals > 0 ? "Requires review" : "All clear"}
              onClick={() => navigate("/approvals")}
            />
            <MetricCard
              label="Active Sessions"
              value={data.activeSessions}
              accent="cyan"
              icon="⊡"
              sub="Across all channels"
              onClick={() => navigate("/sessions")}
            />
            <MetricCard
              label="Running Executions"
              value={data.runningExecutions}
              accent={data.runningExecutions > 0 ? "cyan" : undefined}
              icon="⚙"
              sub={data.runningExecutions > 0 ? "In progress" : "Idle"}
              onClick={() => navigate("/executions")}
            />
            <MetricCard
              label="Recent Denials"
              value={data.recentDenials}
              accent={data.recentDenials > 0 ? "amber" : undefined}
              icon="⚑"
              sub="Policy rejections"
              onClick={() => navigate("/risk")}
            />
          </div>

          {/* Services + Channels row */}
          <div className="grid-2">
            {/* Service Health */}
            <Card>
              <CardHeader
                title="Service Health"
                subtitle={`${onlineCount}/${totalCount} online`}
                icon="◉"
                actions={
                  <Badge variant={onlineCount === totalCount ? "success" : onlineCount === 0 ? "error" : "warning"}>
                    {onlineCount === totalCount ? "All healthy" : onlineCount === 0 ? "Offline" : "Degraded"}
                  </Badge>
                }
              />
              <ServiceHealthGrid services={data.services} />
            </Card>

            {/* Channels */}
            <Card>
              <CardHeader title="Channels" icon="◈" actions={
                <Button variant="ghost" size="sm" onClick={() => navigate("/channels")}>View all</Button>
              } />
              <div className="channel-list">
                {/* Telegram */}
                <div className="channel-row">
                  <div className="channel-row__left">
                    <StatusDot
                      status={
                        data.telegramStatus?.configured
                          ? data.telegramStatus.poller?.running ? "online"
                          : data.telegramStatus.mode === "webhook" ? "online"
                          : "warning"
                          : "offline"
                      }
                    />
                    <span className="channel-row__name">Telegram</span>
                  </div>
                  <div className="channel-row__right">
                    {data.telegramStatus?.configured ? (
                      <>
                        <StatusBadge status={data.telegramStatus.mode ?? "disabled"} />
                        {data.telegramStatus.poller?.updatesReceived != null && (
                          <span className="channel-row__meta">
                            {data.telegramStatus.poller.updatesReceived} updates
                          </span>
                        )}
                      </>
                    ) : (
                      <Badge variant="dim">Not configured</Badge>
                    )}
                  </div>
                </div>

                {/* Web UI */}
                <div className="channel-row">
                  <div className="channel-row__left">
                    <StatusDot status="online" />
                    <span className="channel-row__name">Web UI / Terminal</span>
                  </div>
                  <div className="channel-row__right">
                    <Badge variant="success">Always on</Badge>
                  </div>
                </div>

                {/* Slack */}
                <div className="channel-row">
                  <div className="channel-row__left">
                    <StatusDot status="offline" />
                    <span className="channel-row__name">Slack</span>
                  </div>
                  <div className="channel-row__right">
                    <Badge variant="dim">Not configured</Badge>
                  </div>
                </div>
              </div>
            </Card>
          </div>

          {/* Nodes + Quick Actions */}
          <div className="grid-2">
            {/* Nodes */}
            <Card>
              <CardHeader
                title="Nodes"
                icon="⊛"
                actions={<Button variant="ghost" size="sm" onClick={() => navigate("/nodes")}>View all</Button>}
              />
              {data.nodeCount === 0 ? (
                <EmptyState icon="⊛" title="No nodes registered" description="Remote nodes appear here when paired" />
              ) : (
                <div className="nodes-summary">
                  <div className="nodes-summary__row">
                    <span className="nodes-summary__label">Total nodes</span>
                    <span className="nodes-summary__value">{data.nodeCount}</span>
                  </div>
                  <div className="nodes-summary__row">
                    <span className="nodes-summary__label">Active</span>
                    <span className="nodes-summary__value" style={{ color: "var(--success)" }}>
                      {data.healthyNodes}
                    </span>
                  </div>
                  <div className="nodes-summary__row">
                    <span className="nodes-summary__label">Offline / Quarantined</span>
                    <span className="nodes-summary__value" style={{ color: data.nodeCount - data.healthyNodes > 0 ? "var(--error)" : "var(--text-muted)" }}>
                      {data.nodeCount - data.healthyNodes}
                    </span>
                  </div>
                </div>
              )}
            </Card>

            {/* Quick Actions */}
            <Card>
              <CardHeader title="Quick Actions" icon="⌖" />
              <div className="quick-actions-grid">
                <QuickAction label="Review Approvals" icon="⊘" to="/approvals" accent="amber" />
                <QuickAction label="Trace Explorer" icon="⊹" to="/traces" accent="violet" />
                <QuickAction label="Add Channel" icon="◈" to="/channels" accent="cyan" />
                <QuickAction label="Live Activity" icon="◎" to="/activity" />
                <QuickAction label="Policy Decisions" icon="⊟" to="/policy" accent="violet" />
                <QuickAction label="Risk Dashboard" icon="⚑" to="/risk" accent="amber" />
              </div>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
