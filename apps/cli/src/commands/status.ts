/**
 * manasvi status
 * Shows health of all services and current configuration.
 */

import { banner, section, table, info, warn, success, hint, style } from "../lib/ui.js";
import { loadConfig } from "../lib/config.js";
import { isProcessAlive } from "../lib/services.js";
import { loadPids } from "../lib/config.js";
import { checkAllServices, checkServiceHealth, checkAnthropic, checkOllama, getServiceSpecs } from "../lib/health.js";
import { envFilePath, readEnvFile } from "../lib/env.js";
import { printJson, jsonOk, jsonFail } from "../lib/json.js";

export async function runStatus(opts: {
  verbose?: boolean;
  json?: boolean;
  service?: string;
} = {}): Promise<void> {
  const config = await loadConfig();

  if (!config?.initialized) {
    if (opts.json) {
      printJson(jsonFail("status", [{ code: "not_initialized", message: "Manasvi is not initialized", fix: "pnpm manasvi init" }]));
      process.exit(1);
    }
    warn("Manasvi is not initialized. Run: pnpm manasvi init");
    return;
  }

  const pids = await loadPids();

  // Single-service mode
  if (opts.service) {
    await runServiceStatus(opts.service, config, pids, opts);
    return;
  }

  // All-services mode
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

  const healthyCount = health.filter((h) => h.status === "healthy").length;
  const total = health.length;

  if (opts.json) {
    const warnings = [];
    const errors = [];
    const nextStepsList = [];

    if (healthyCount === 0) {
      errors.push({ code: "services.all_down", message: "No services are running", fix: "pnpm manasvi start" });
      nextStepsList.push("pnpm manasvi start");
    } else if (healthyCount < total) {
      warnings.push({ code: "services.partial", message: `${healthyCount}/${total} services healthy` });
      nextStepsList.push("pnpm manasvi doctor");
    }

    const providerLabels: Record<string, string> = {
      ollama: `Ollama (${config.model.ollamaModel}) @ ${config.model.ollamaBaseUrl}`,
      openai: `OpenAI (${config.model.openaiModel})`,
      claude: `Claude (${config.model.claudeModel})`,
      mock: "Mock (testing mode)",
      deepseek: `DeepSeek (${config.model.deepseekModel})`
    };

    printJson(jsonOk("status", {
      initialized: config.initialized,
      onboarded: config.onboarded,
      profile: config.profile,
      services: health.map((h) => ({
        name: h.name,
        label: h.label,
        port: h.port,
        status: h.status,
        latencyMs: h.latencyMs,
        pid: pids[h.name]
      })),
      summary: {
        healthy: healthyCount,
        total,
        allHealthy: healthyCount === total
      },
      model: providerLabels[config.model.provider] ?? config.model.provider,
      channels: Object.entries(config.channels)
        .filter(([, v]) => v?.enabled)
        .map(([k]) => k),
      docsUrl: config.ui.docsEnabled ? `http://localhost:${config.ui.docsPort}` : null
    }, { warnings, nextSteps: nextStepsList }));
    return;
  }

  // Human output
  banner("status");

  section("Services");
  table(serviceRows);

  console.log();
  if (healthyCount === total) {
    success(`All ${total} services healthy`);
  } else if (healthyCount === 0) {
    warn("No services are running. Start with: pnpm manasvi start");
  } else {
    info(`${healthyCount}/${total} services healthy`);
    hint("Run `pnpm manasvi doctor` to diagnose issues");
  }

  section("Configuration");

  const providerLabels: Record<string, string> = {
    ollama: `Ollama (${config.model.ollamaModel}) @ ${config.model.ollamaBaseUrl}`,
    openai: `OpenAI (${config.model.openaiModel})`,
    claude: `Claude (${config.model.claudeModel})`,
    mock: "Mock (testing mode)",
    deepseek: `DeepSeek (${config.model.deepseekModel})`
  };

  const channelList = Object.entries(config.channels)
    .filter(([, v]) => v?.enabled)
    .map(([k]) => k)
    .join(", ") || "none";

  table([
    { label: "Profile", value: config.profile },
    { label: "Project", value: config.projectPath },
    { label: "Workspace", value: config.workspacePath },
    { label: "Model", value: providerLabels[config.model.provider] ?? config.model.provider },
    { label: "Channels", value: channelList },
    { label: "Docs UI", value: config.ui.docsEnabled ? `http://localhost:${config.ui.docsPort}` : "disabled" }
  ]);

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

  if (opts.verbose && config.model.provider === "claude") {
    section("Model Backend");
    const env = await readEnvFile(envFilePath(config.projectPath));
    const apiKey = env.ANTHROPIC_API_KEY ?? "";
    if (!apiKey) {
      warn("ANTHROPIC_API_KEY missing");
    } else {
      const ok = await checkAnthropic(config.model.claudeBaseUrl, apiKey);
      if (ok) {
        success(`Claude reachable at ${config.model.claudeBaseUrl}`);
      } else {
        warn(`Claude not reachable at ${config.model.claudeBaseUrl}`);
      }
    }
  }

  if (healthyCount < total) {
    console.log();
    hint("Run `pnpm manasvi logs <service>` to inspect service logs");
    hint("Run `pnpm manasvi doctor` for a full diagnostic");
  }

  console.log();
}

async function runServiceStatus(
  serviceName: string,
  config: NonNullable<Awaited<ReturnType<typeof loadConfig>>>,
  pids: Record<string, number>,
  opts: { verbose?: boolean; json?: boolean }
): Promise<void> {
  const specs = getServiceSpecs(config);
  const spec = specs.find((s) => s.name === serviceName || s.label.toLowerCase() === serviceName.toLowerCase());

  if (!spec) {
    const names = specs.map((s) => s.name).join(", ");
    if (opts.json) {
      printJson(jsonFail("status", [{ code: "service.not_found", message: `Unknown service: ${serviceName}`, fix: `Valid services: ${names}` }]));
    } else {
      console.error(`Unknown service: ${serviceName}`);
      console.log(`Valid services: ${names}`);
    }
    process.exit(1);
  }

  const health = await checkServiceHealth(spec);
  const pid = pids[spec.name];
  const alive = pid ? isProcessAlive(pid) : false;

  if (opts.json) {
    printJson(jsonOk("status", {
      name: spec.name,
      label: spec.label,
      port: spec.port,
      status: health.status,
      latencyMs: health.latencyMs,
      pid,
      alive
    }));
    return;
  }

  banner(`status: ${spec.label}`);
  section("Service");

  const statusLabel = health.status === "healthy"
    ? style.green(`● healthy${health.latencyMs ? ` (${health.latencyMs}ms)` : ""}`)
    : alive
      ? style.yellow("○ running (not ready)")
      : style.dim("○ stopped");

  table([
    { label: "Name", value: spec.name },
    { label: "Port", value: String(spec.port) },
    { label: "Status", value: statusLabel },
    ...(opts.verbose && pid ? [{ label: "PID", value: String(pid) }] : [])
  ]);

  if (health.status !== "healthy") {
    console.log();
    hint(`Logs: pnpm manasvi logs ${spec.name}`);
    hint(`Start: pnpm manasvi start ${spec.name}`);
  }
  console.log();
}
