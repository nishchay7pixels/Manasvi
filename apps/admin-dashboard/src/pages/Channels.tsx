import { useNavigate } from "react-router-dom";
import { usePolling } from "../hooks/useApi.js";
import { fetchTelegramStatus, fetchServiceHealth } from "../api/client.js";
import {
  Card, Badge, StatusBadge, StatusDot, Button
} from "../components/ui/primitives.js";
import "./channels.css";

// ── Channel card ──────────────────────────────────────────────────────────

interface ChannelCardProps {
  name: string;
  icon: string;
  configured: boolean;
  enabled: boolean;
  mode?: string;
  description: string;
  stats?: { label: string; value: string }[];
  lastError?: string | null;
  actions?: React.ReactNode;
}

function ChannelCard({
  name, icon, configured, enabled, mode,
  description, stats, lastError, actions
}: ChannelCardProps) {
  const statusDot: "online" | "offline" | "warning" =
    configured && enabled ? "online" : configured ? "warning" : "offline";

  return (
    <Card accent={configured && enabled ? "cyan" : undefined} className="channel-card">
      <div className="channel-card__header">
        <div className="channel-card__title-row">
          <span className="channel-card__icon">{icon}</span>
          <span className="channel-card__name">{name}</span>
          <StatusDot status={statusDot} size={8} />
        </div>
        <div className="channel-card__badges">
          {configured ? (
            <StatusBadge status={enabled ? "enabled" : "disabled"} />
          ) : (
            <Badge variant="dim">Not configured</Badge>
          )}
          {mode && <Badge variant="dim">{mode}</Badge>}
        </div>
      </div>

      <p className="channel-card__desc">{description}</p>

      {stats && stats.length > 0 && (
        <div className="channel-card__stats">
          {stats.map((s) => (
            <div key={s.label} className="channel-card__stat">
              <span className="channel-card__stat-label">{s.label}</span>
              <span className="channel-card__stat-value">{s.value}</span>
            </div>
          ))}
        </div>
      )}

      {lastError && (
        <div className="channel-card__error">
          <span>⚠</span> {lastError}
        </div>
      )}

      {actions && <div className="channel-card__actions">{actions}</div>}
    </Card>
  );
}

// ── Channels page ─────────────────────────────────────────────────────────

export function Channels() {
  const navigate = useNavigate();
  const { data: telegram } = usePolling(fetchTelegramStatus, 10_000);
  const { data: services } = usePolling(fetchServiceHealth, 15_000);

  const ingressOnline = services?.find((s) => s.name === "Ingress")?.online ?? false;

  const telegramStats = telegram?.poller
    ? [
        { label: "Updates received", value: String(telegram.poller.updatesReceived) },
        { label: "Offset", value: String(telegram.poller.offset) },
        { label: "Last poll", value: telegram.poller.lastPollAt ? new Date(telegram.poller.lastPollAt).toLocaleTimeString() : "—" },
        { label: "Errors", value: telegram.poller.consecutiveErrors > 0 ? String(telegram.poller.consecutiveErrors) : "None" },
      ]
    : undefined;

  return (
    <div className="page channels-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Channels</h1>
          <p className="page-subtitle">Configured inbound and outbound message channels</p>
        </div>
        <Button variant="primary" size="sm" onClick={() => navigate("/")}>
          + Add channel
        </Button>
      </div>

      {/* Ingress status */}
      <div className="ingress-status">
        <StatusDot status={ingressOnline ? "online" : "offline"} />
        <span>
          Ingress service is{" "}
          <strong style={{ color: ingressOnline ? "var(--success)" : "var(--error)" }}>
            {ingressOnline ? "running" : "offline"}
          </strong>
          {" "}<span style={{ color: "var(--text-muted)" }}>— port 4101</span>
        </span>
      </div>

      <div className="channels-grid">
        {/* Telegram */}
        <ChannelCard
          name="Telegram"
          icon="✈"
          configured={telegram?.configured ?? false}
          enabled={(telegram?.configured && telegram.mode !== "disabled") ?? false}
          mode={telegram?.mode}
          description="Bot API integration. Polling mode works locally without a public URL. Webhook mode for production deployments."
          stats={telegramStats}
          lastError={telegram?.poller?.lastError ?? null}
          actions={
            <Button variant="secondary" size="sm"
              onClick={() => window.open("https://t.me/BotFather", "_blank")}
            >
              Open BotFather →
            </Button>
          }
        />

        {/* Web UI */}
        <ChannelCard
          name="Web UI / Terminal"
          icon="⌨"
          configured={true}
          enabled={true}
          mode="api"
          description="Always-on REST interface and terminal harness. Accessible at the API gateway test-harness endpoint."
          stats={[
            { label: "Gateway", value: ingressOnline ? "http://localhost:4100" : "offline" },
            { label: "Chat UI", value: "http://localhost:4100/test-harness/chat" },
          ]}
        />

        {/* Slack */}
        <ChannelCard
          name="Slack"
          icon="#"
          configured={false}
          enabled={false}
          description="Slack workspace integration via Events API. Requires a Slack app with bot token and signing secret."
          actions={
            <Button variant="ghost" size="sm">
              Configure →
            </Button>
          }
        />

        {/* Generic Webhook */}
        <ChannelCard
          name="Generic Webhook"
          icon="⊕"
          configured={false}
          enabled={false}
          description="HTTP webhook endpoint for custom integrations. Secured with a shared secret header."
          actions={
            <Button variant="ghost" size="sm">
              Configure →
            </Button>
          }
        />
      </div>

      {/* Setup hint */}
      {!telegram?.configured && (
        <div className="channel-hint">
          <span className="channel-hint__icon">💡</span>
          <div>
            <strong>Easy start:</strong> Telegram is the simplest channel to add. Run{" "}
            <code>pnpm manasvi channels add telegram</code> in your terminal —
            polling mode requires no public URL.
          </div>
        </div>
      )}
    </div>
  );
}
