import { usePolling } from "../hooks/useApi.js";
import { fetchServiceHealth } from "../api/client.js";
import { Card, CardHeader, Badge, StatusDot } from "../components/ui/primitives.js";
import "./settings.css";

interface SettingRow { label: string; value: string; note?: string; mono?: boolean; }

function SettingsSection({ title, rows }: { title: string; rows: SettingRow[] }) {
  return (
    <Card>
      <CardHeader title={title} icon="⊜" />
      <div className="settings-rows">
        {rows.map((r) => (
          <div key={r.label} className="settings-row">
            <span className="settings-row__label">{r.label}</span>
            <div className="settings-row__value-col">
              <span className={`settings-row__value${r.mono ? " mono" : ""}`}>{r.value}</span>
              {r.note && <span className="settings-row__note">{r.note}</span>}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

export function Settings() {
  const { data: services } = usePolling(fetchServiceHealth, 15_000);


  return (
    <div className="page settings-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Settings</h1>
          <p className="page-subtitle">Runtime configuration, service ports, and environment preferences</p>
        </div>
        <Badge variant="dim">local profile</Badge>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <SettingsSection
          title="Environment"
          rows={[
            { label: "Profile", value: "local", note: "Set via MANASVI_ENV" },
            { label: "Log level", value: "info", note: "Set via LOG_LEVEL" },
            { label: "Human-readable logs", value: "true", mono: true },
            { label: "Secret provider", value: "env", note: "Secrets read from environment" },
          ]}
        />

        <SettingsSection
          title="Agent Runtime"
          rows={[
            { label: "Max iterations", value: "6", note: "AGENT_LOOP_MAX_ITERATIONS", mono: true },
            { label: "Max consecutive failures", value: "2", note: "AGENT_LOOP_MAX_CONSECUTIVE_FAILURES", mono: true },
            { label: "Context token budget", value: "2048", note: "SESSION_CONTEXT_TOKEN_BUDGET", mono: true },
            { label: "Recent message limit", value: "20", note: "SESSION_RECENT_MESSAGE_LIMIT", mono: true },
          ]}
        />

        <SettingsSection
          title="Security"
          rows={[
            { label: "Channel signature required", value: "true", mono: true },
            { label: "Web UI adapter auth required", value: "true", mono: true },
            { label: "Rate limit window", value: "60,000 ms", note: "INGRESS_RATE_LIMIT_WINDOW_MS", mono: true },
            { label: "Rate limit max per source", value: "60", note: "INGRESS_RATE_LIMIT_MAX_PER_SOURCE", mono: true },
            { label: "Anti-spam duplicate TTL", value: "10,000 ms", note: "INGRESS_ANTI_SPAM_DUPLICATE_TTL_MS", mono: true },
          ]}
        />

        <SettingsSection
          title="Memory"
          rows={[
            { label: "Ephemeral TTL", value: "3,600 s", mono: true },
            { label: "Untrusted TTL", value: "7,200 s", mono: true },
            { label: "Retention prune interval", value: "300 s", mono: true },
          ]}
        />

        {services && (
          <Card>
            <CardHeader title="Service Ports" icon="◉" />
            <div className="service-port-grid">
              {services.map((s) => (
                <div key={s.name} className="service-port-row">
                  <StatusDot status={s.online ? "online" : "offline"} size={7} />
                  <span className="service-port-row__name">{s.name}</span>
                  <code className="service-port-row__port">{s.port}</code>
                  <span className="service-port-row__status" style={{
                    color: s.online ? "var(--success)" : "var(--text-muted)"
                  }}>
                    {s.online ? "online" : "offline"}
                  </span>
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
