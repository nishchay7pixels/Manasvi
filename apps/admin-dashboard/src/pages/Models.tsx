import { usePolling } from "../hooks/useApi.js";
import { fetchServiceHealth } from "../api/client.js";
import { Card, Badge, StatusDot } from "../components/ui/primitives.js";
import "./models.css";

interface ProviderConfig {
  id: string;
  name: string;
  icon: string;
  envKey: string;
  description: string;
  defaultModel: string;
  modelsHint: string;
  isLocal: boolean;
}

const PROVIDERS: ProviderConfig[] = [
  {
    id: "ollama",
    name: "Ollama",
    icon: "🦙",
    envKey: "MODEL_ADAPTER_MODE=ollama",
    description: "Run open-source models locally. No API key required. Start with llama3.2, mistral, or qwen2.5.",
    defaultModel: "llama3.2",
    modelsHint: "ollama pull llama3.2",
    isLocal: true,
  },
  {
    id: "openai",
    name: "OpenAI",
    icon: "◎",
    envKey: "MODEL_ADAPTER_MODE=openai",
    description: "Use GPT-4o and other OpenAI models via API key. Requires OPENAI_API_KEY in environment.",
    defaultModel: "gpt-4o-mini",
    modelsHint: "platform.openai.com",
    isLocal: false,
  },
  {
    id: "claude",
    name: "Claude (Anthropic)",
    icon: "◈",
    envKey: "MODEL_ADAPTER_MODE=claude",
    description: "Use Claude models via Anthropic API. Requires ANTHROPIC_API_KEY in environment.",
    defaultModel: "claude-sonnet-4-6",
    modelsHint: "console.anthropic.com",
    isLocal: false,
  },
  {
    id: "mock",
    name: "Mock (Testing)",
    icon: "⚙",
    envKey: "MODEL_ADAPTER_MODE=mock",
    description: "Simulated responses for testing the system pipeline without a real model. Safe for local dev.",
    defaultModel: "mock-v1",
    modelsHint: "Built-in, no setup needed",
    isLocal: true,
  },
];

export function Models() {
  const { data: services } = usePolling(fetchServiceHealth, 15_000);
  const orchestratorOnline = services?.find((s) => s.name === "Orchestrator")?.online ?? false;

  // Default to mock for local dev; real deployments would query orchestrator config
  const activeMode = "mock";

  return (
    <div className="page models-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Models &amp; Providers</h1>
          <p className="page-subtitle">AI model provider configuration and health</p>
        </div>
      </div>

      {/* Orchestrator status */}
      <div className="models-orchestrator-status">
        <StatusDot status={orchestratorOnline ? "online" : "offline"} />
        <span>
          Orchestrator is{" "}
          <strong style={{ color: orchestratorOnline ? "var(--success)" : "var(--error)" }}>
            {orchestratorOnline ? "online" : "offline"}
          </strong>
          {" "}— model routing handled by orchestrator-service (port 4102)
        </span>
      </div>

      <div className="providers-grid">
        {PROVIDERS.map((p) => {
          const isActive = activeMode === p.id;
          return (
            <Card key={p.id} accent={isActive ? "cyan" : undefined} className="provider-card">
              <div className="provider-card__header">
                <div className="provider-card__title-row">
                  <span className="provider-card__icon">{p.icon}</span>
                  <div>
                    <div className="provider-card__name">{p.name}</div>
                    {p.isLocal && <Badge variant="success">Local</Badge>}
                  </div>
                </div>
                {isActive && <Badge variant="cyan" dot>Active</Badge>}
              </div>

              <p className="provider-card__desc">{p.description}</p>

              <div className="provider-card__detail">
                <div className="provider-card__row">
                  <span className="provider-card__label">Default model</span>
                  <code className="provider-card__code">{p.defaultModel}</code>
                </div>
                <div className="provider-card__row">
                  <span className="provider-card__label">Env flag</span>
                  <code className="provider-card__code">{p.envKey}</code>
                </div>
                <div className="provider-card__row">
                  <span className="provider-card__label">Models / Docs</span>
                  <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{p.modelsHint}</span>
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      <div className="models-setup-hint">
        <strong>Configure via CLI:</strong>{" "}
        <code>pnpm manasvi onboard</code> — walks you through selecting and validating a model provider.
      </div>
    </div>
  );
}
