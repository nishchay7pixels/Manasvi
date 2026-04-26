/**
 * manasvi status
 * Shows health of all services and current configuration.
 */

import { banner, section, table, info, warn, success, hint, style } from "../lib/ui.js";
import { loadConfig } from "../lib/config.js";
import { isProcessAlive } from "../lib/services.js";
import { loadPids } from "../lib/config.js";
import { checkAllServices, checkOllama } from "../lib/health.js";

export async function runStatus(opts: { verbose?: boolean } = {}): Promise<void> {
  banner("status");

  const config = await loadConfig();
  if (!config?.initialized) {
    warn("Manasvi is not initialized. Run: pnpm manasvi init");
    return;
  }

  // ── Services ────────────────────────────────────────────────────────────────

  section("Services");

  const pids = await loadPids();
  const health = await checkAllServices(config);

  const serviceRows = health.map((h) => {
    const pid = pids[h.name];
    const alive = pid ? isProcessAlive(pid) : false;
    const portStr = `:${h.port}`;

    let statusLabel: string;
    let statusType: "ok" | "error" | "warn" | "dim";

    if (h.status === "healthy") {
      statusLabel = `● healthy${h.latencyMs ? ` (${h.latencyMs}ms)` : ""}`;
      statusType = "ok";
    } else if (alive) {
      statusLabel = "○ running (not ready)";
      statusType = "warn";
    } else {
      statusLabel = "○ stopped";
      statusType = "dim";
    }

    return {
      label: h.label,
      value: `${portStr}   ${statusLabel}${opts.verbose && pid ? `   pid:${pid}` : ""}`,
      status: statusType
    };
  });

  table(serviceRows);

  const healthyCount = health.filter((h) => h.status === "healthy").length;
  const total = health.length;

  console.log();
  if (healthyCount === total) {
    success(`All ${total} services healthy`);
  } else if (healthyCount === 0) {
    warn("No services are running. Start with: pnpm manasvi start");
  } else {
    info(`${healthyCount}/${total} services healthy`);
    hint("Run `pnpm manasvi doctor` to diagnose issues");
  }

  // ── Configuration ────────────────────────────────────────────────────────────

  section("Configuration");

  const providerLabels: Record<string, string> = {
    ollama: `Ollama (${config.model.ollamaModel}) @ ${config.model.ollamaBaseUrl}`,
    openai: `OpenAI (${config.model.openaiModel})`,
    mock: "Mock (testing mode)"
  };

  const channelList = Object.entries(config.channels)
    .filter(([, v]) => v?.enabled)
    .map(([k]) => k)
    .join(", ") || "none";

  table([
    { label: "Profile", value: config.profile },
    { label: "Project", value: config.projectPath },
    { label: "Model", value: providerLabels[config.model.provider] ?? config.model.provider },
    { label: "Channels", value: channelList },
    { label: "Docs UI", value: config.ui.docsEnabled ? `http://localhost:${config.ui.docsPort}` : "disabled" }
  ]);

  // ── Model backend check ──────────────────────────────────────────────────────

  if (opts.verbose && config.model.provider === "ollama") {
    section("Model Backend");
    const ollamaOk = await checkOllama(config.model.ollamaBaseUrl);
    if (ollamaOk) {
      success(`Ollama reachable at ${config.model.ollamaBaseUrl}`);
    } else {
      warn(`Ollama not reachable at ${config.model.ollamaBaseUrl}`);
      hint("Start with: ollama serve");
    }
  }

  console.log();
}
