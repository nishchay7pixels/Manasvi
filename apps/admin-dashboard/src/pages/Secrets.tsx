import { Card, CardHeader, Badge } from "../components/ui/primitives.js";
import "./secrets.css";

interface SecretRef {
  key: string;
  owningSubsystem: string;
  provider: string;
  required: boolean;
  present: boolean;
  dependents: string[];
}

// Static manifest of known secret references — real values are never shown
const SECRET_MANIFEST: SecretRef[] = [
  { key: "EVENT_SIGNING_KEYS", owningSubsystem: "Ingress", provider: "env", required: true, present: true, dependents: ["ingress-service"] },
  { key: "INTERNAL_AUTH_KEY_ID", owningSubsystem: "Internal Auth", provider: "env", required: true, present: true, dependents: ["all services"] },
  { key: "INTERNAL_AUTH_SIGNING_SECRET", owningSubsystem: "Internal Auth", provider: "env", required: true, present: true, dependents: ["all services"] },
  { key: "TELEGRAM_BOT_TOKEN", owningSubsystem: "Ingress / Telegram", provider: "env", required: false, present: false, dependents: ["ingress-service"] },
  { key: "TELEGRAM_WEBHOOK_SECRET", owningSubsystem: "Ingress / Telegram", provider: "env", required: false, present: false, dependents: ["ingress-service"] },
  { key: "SLACK_BOT_TOKEN", owningSubsystem: "Ingress / Slack", provider: "env", required: false, present: false, dependents: ["ingress-service"] },
  { key: "SLACK_SIGNING_SECRET", owningSubsystem: "Ingress / Slack", provider: "env", required: false, present: false, dependents: ["ingress-service"] },
  { key: "OPENAI_API_KEY", owningSubsystem: "Model Adapter", provider: "env", required: false, present: false, dependents: ["orchestrator-service"] },
  { key: "ANTHROPIC_API_KEY", owningSubsystem: "Model Adapter", provider: "env", required: false, present: false, dependents: ["orchestrator-service"] },
  { key: "MEMORY_ENCRYPTION_KEY", owningSubsystem: "Memory", provider: "env", required: true, present: true, dependents: ["memory-service"] },
  { key: "APPROVAL_SIGNING_KEYS", owningSubsystem: "Approval", provider: "env", required: true, present: true, dependents: ["approval-service"] },
  { key: "GENERIC_WEBHOOK_SHARED_SECRET", owningSubsystem: "Ingress / Webhook", provider: "env", required: false, present: false, dependents: ["ingress-service"] },
];

export function Secrets() {
  const requiredMissing = SECRET_MANIFEST.filter((s) => s.required && !s.present);
  const optionalMissing = SECRET_MANIFEST.filter((s) => !s.required && !s.present);

  return (
    <div className="page secrets-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Secrets</h1>
          <p className="page-subtitle">Secret reference manifest — presence, ownership, and dependent services</p>
        </div>
      </div>

      <div className="secrets-notice">
        <span className="secrets-notice__icon">⊗</span>
        <div>
          Secret values are <strong>never displayed</strong>. This page shows reference presence
          and metadata only. All secrets are injected via environment variables or a secrets provider.
        </div>
      </div>

      {requiredMissing.length > 0 && (
        <div className="secrets-alert">
          <span>⚠</span>
          {requiredMissing.length} required secret{requiredMissing.length !== 1 ? "s" : ""} missing:{" "}
          {requiredMissing.map((s) => s.key).join(", ")}
        </div>
      )}

      {/* Status summary */}
      <div className="grid-3">
        {[
          { label: "Total secrets", value: SECRET_MANIFEST.length, accent: undefined },
          { label: "Present", value: SECRET_MANIFEST.filter((s) => s.present).length, accent: "success" },
          { label: "Missing (optional)", value: optionalMissing.length, accent: "dim" },
        ].map((m) => (
          <Card key={m.label}>
            <div style={{ fontSize: 28, fontWeight: 700, color: m.accent ? `var(--${m.accent})` : "var(--text-primary)" }}>
              {m.value}
            </div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>{m.label}</div>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader title="Secret Manifest" icon="⊗" />
        <div className="secrets-table">
          <div className="secrets-table__header">
            <span>Key</span>
            <span>Subsystem</span>
            <span>Provider</span>
            <span>Status</span>
            <span>Required</span>
            <span>Dependents</span>
          </div>
          {SECRET_MANIFEST.map((s) => (
            <div key={s.key} className={`secrets-table__row ${s.required && !s.present ? "secrets-table__row--alert" : ""}`}>
              <code className="secrets-table__key">{s.key}</code>
              <span className="secrets-table__sub">{s.owningSubsystem}</span>
              <Badge variant="dim">{s.provider}</Badge>
              <Badge variant={s.present ? "success" : s.required ? "error" : "dim"}>
                {s.present ? "present" : "missing"}
              </Badge>
              <Badge variant={s.required ? "amber" : "dim"}>{s.required ? "required" : "optional"}</Badge>
              <span className="secrets-table__deps">{s.dependents.join(", ")}</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
