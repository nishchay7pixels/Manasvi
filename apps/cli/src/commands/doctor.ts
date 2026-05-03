/**
 * manasvi doctor
 * Diagnoses common setup problems with actionable fixes.
 */

import { execSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { banner, section, checkRow, warn, success, info, hint, error as printError } from "../lib/ui.js";
import { loadConfig, cliHomePath } from "../lib/config.js";
import { fileExists, envFilePath, readEnvFile } from "../lib/env.js";
import { checkAllServices, checkAnthropic, checkDeepSeek, checkOllama, checkOpenAI, isPortInUse } from "../lib/health.js";

type CheckStatus = "pass" | "warn" | "fail" | "skip";

interface Check {
  label: string;
  status: CheckStatus;
  detail?: string;
  fix?: string;
}

async function runChecks(config: Awaited<ReturnType<typeof loadConfig>>): Promise<Check[]> {
  const checks: Check[] = [];

  // ── Prerequisites ────────────────────────────────────────────────────────────

  const nodeMajor = parseInt(process.version.slice(1).split(".")[0] ?? "0", 10);
  checks.push({
    label: "Node.js ≥ 20",
    status: nodeMajor >= 20 ? "pass" : "fail",
    detail: process.version,
    fix: nodeMajor < 20 ? "Install Node.js 20+ from https://nodejs.org" : undefined
  });

  try {
    execSync("pnpm --version", { stdio: "ignore" });
    checks.push({ label: "pnpm installed", status: "pass" });
  } catch {
    checks.push({ label: "pnpm installed", status: "fail", fix: "Run: corepack enable" });
  }

  // ── CLI config ───────────────────────────────────────────────────────────────

  const configExists = await fileExists(join(cliHomePath(), "config.json"));
  checks.push({
    label: "CLI config exists",
    status: configExists ? "pass" : "fail",
    fix: configExists ? undefined : "Run: pnpm manasvi init"
  });

  if (!config?.initialized) {
    checks.push({
      label: "Manasvi initialized",
      status: "fail",
      fix: "Run: pnpm manasvi init"
    });
    return checks;
  }

  checks.push({ label: "Manasvi initialized", status: "pass" });

  // ── .env.local ───────────────────────────────────────────────────────────────

  const envPath = envFilePath(config.projectPath);
  const envExists = await fileExists(envPath);
  checks.push({
    label: ".env.local exists",
    status: envExists ? "pass" : "fail",
    fix: envExists ? undefined : "Run: pnpm manasvi init"
  });

  if (envExists) {
    const env = await readEnvFile(envPath);

    const requiredSecrets = [
      "INTERNAL_AUTH_KEY_ID",
      "INTERNAL_AUTH_SIGNING_SECRET",
      "APPROVAL_SIGNING_KEYS",
      "APPROVAL_VERIFICATION_KEYS"
    ];

    const missing = requiredSecrets.filter((k) => !env[k] || env[k] === "replace-me");
    checks.push({
      label: "Required secrets set",
      status: missing.length === 0 ? "pass" : "fail",
      detail: missing.length > 0 ? `Missing: ${missing.join(", ")}` : undefined,
      fix: missing.length > 0 ? "Run: pnpm manasvi init --force" : undefined
    });

    // Model config
    const modelMode = env.MODEL_ADAPTER_MODE ?? env.MANASVI_MODEL_PROVIDER ?? "deepseek";
    const modelName = env.PLANNER_MODEL ?? env.MANASVI_MODEL ?? "deepseek-v4-flash";
    checks.push({
      label: "Model provider",
      status: "pass",
      detail: modelMode
    });
    checks.push({
      label: "Model",
      status: "pass",
      detail: modelName
    });

    if (modelMode === "deepseek") {
      const hasKey = env.DEEPSEEK_API_KEY && env.DEEPSEEK_API_KEY !== "replace-me";
      checks.push({
        label: "DeepSeek API key",
        status: hasKey ? "pass" : "fail",
        detail: hasKey ? "configured" : "missing",
        fix: hasKey ? undefined : "Fix: set DEEPSEEK_API_KEY"
      });
    }

    if (modelMode === "openai") {
      const hasKey = env.OPENAI_API_KEY && env.OPENAI_API_KEY !== "replace-me";
      checks.push({
        label: "OpenAI API key set",
        status: hasKey ? "pass" : "fail",
        fix: hasKey ? undefined : "Run: pnpm manasvi models add openai"
      });
    }
    if (modelMode === "claude") {
      const hasKey = env.ANTHROPIC_API_KEY && env.ANTHROPIC_API_KEY !== "replace-me";
      checks.push({
        label: "Anthropic API key set",
        status: hasKey ? "pass" : "fail",
        fix: hasKey ? undefined : "Run: pnpm manasvi models add claude"
      });
    }

    // Telegram
    const telegramToken = env.TELEGRAM_BOT_TOKEN;
    const telegramMode = env.TELEGRAM_ADAPTER_MODE ?? "polling";
    const telegramEnabled = config.channels.telegram?.enabled;

    if (telegramEnabled || (telegramToken && telegramToken !== "replace-me")) {
      // Token presence and format
      if (!telegramToken || telegramToken === "replace-me") {
        checks.push({
          label: "Telegram bot token",
          status: "fail",
          detail: "Token missing — channel is enabled but TELEGRAM_BOT_TOKEN is not set",
          fix: "Run: pnpm manasvi channels add telegram"
        });
      } else {
        // Token format: looks like 123456789:AAE... (numeric ID : base64-ish string)
        const tokenFormatOk = /^\d{8,12}:[A-Za-z0-9_-]{35,}$/.test(telegramToken);
        checks.push({
          label: "Telegram bot token",
          status: tokenFormatOk ? "pass" : "warn",
          detail: tokenFormatOk ? `mode: ${telegramMode}` : "Token format looks unexpected — verify you copied it correctly from BotFather",
          fix: tokenFormatOk ? undefined : "Run: pnpm manasvi channels add telegram"
        });
      }

      // Mode-specific checks
      if (telegramMode === "webhook") {
        const webhookUrl = env.TELEGRAM_WEBHOOK_URL;
        checks.push({
          label: "Telegram webhook URL",
          status: webhookUrl && webhookUrl !== "replace-me" ? "pass" : "fail",
          detail: webhookUrl && webhookUrl !== "replace-me" ? webhookUrl : "TELEGRAM_WEBHOOK_URL not set",
          fix: webhookUrl ? undefined : "Set TELEGRAM_WEBHOOK_URL in .env.local or switch to polling mode"
        });
      }

      // Live polling status — only if ingress is expected to be running
      if (telegramToken && telegramToken !== "replace-me" && telegramMode === "polling") {
        try {
          const ingressPort = config.services.ingressPort ?? 4101;
          const res = await fetch(`http://localhost:${ingressPort}/ingress/adapters/telegram_adapter`, {
            signal: AbortSignal.timeout(2000)
          });
          if (res.ok) {
            const data = (await res.json()) as { pollerRunning?: boolean; consecutiveErrors?: number; offset?: number };
            if (data.pollerRunning === true) {
              const errNote = data.consecutiveErrors ? ` · ${data.consecutiveErrors} consecutive error(s)` : "";
              checks.push({
                label: "Telegram poller running",
                status: data.consecutiveErrors ? "warn" : "pass",
                detail: `offset: ${data.offset ?? "—"}${errNote}`
              });
            } else {
              checks.push({
                label: "Telegram poller running",
                status: "warn",
                detail: "Ingress is up but poller is not active",
                fix: "Run: pnpm manasvi restart"
              });
            }
          }
        } catch {
          // Ingress not running — silently skip; port check below will catch it
        }
      }
    }
  }

  // ── Port conflicts ────────────────────────────────────────────────────────────

  const s = config.services;
  const portChecks = [
    [s.gatewayPort, "api-gateway"],
    [s.ingressPort, "ingress-service"],
    [s.orchestratorPort, "orchestrator-service"],
    [s.policyPort, "policy-service"]
  ] as Array<[number, string]>;

  for (const [port, name] of portChecks) {
    const inUse = await isPortInUse(port);
    checks.push({
      label: `Port ${port} (${name})`,
      status: inUse ? "pass" : "warn",
      detail: inUse ? "service responding" : "not running"
    });
  }

  // ── Model backend ─────────────────────────────────────────────────────────────

  if (config.model.provider === "ollama") {
    const ollamaOk = await checkOllama(config.model.ollamaBaseUrl);
    checks.push({
      label: "Ollama reachable",
      status: ollamaOk ? "pass" : "fail",
      detail: config.model.ollamaBaseUrl,
      fix: ollamaOk ? undefined : "Start Ollama: ollama serve"
    });

    if (ollamaOk) {
      // Check if model is available
      try {
        const url = config.model.ollamaBaseUrl.replace(/\/v1\/?$/, "");
        const res = await fetch(`${url}/api/tags`, { signal: AbortSignal.timeout(3000) });
        const data = (await res.json()) as { models?: Array<{ name: string }> };
        const models = data.models?.map((m) => m.name) ?? [];
        const modelName = config.model.ollamaModel;
        const hasModel = models.some((m) => m.includes(modelName.split(":")[0] ?? ""));
        checks.push({
          label: `Ollama model: ${modelName}`,
          status: hasModel ? "pass" : "warn",
          detail: hasModel ? "available" : "not found",
          fix: hasModel ? undefined : `Run: ollama pull ${modelName}`
        });
      } catch {
        checks.push({ label: "Ollama model check", status: "skip", detail: "could not list models" });
      }
    }
  }
  if (config.model.provider === "claude") {
    const env = await readEnvFile(envPath);
    const key = env.ANTHROPIC_API_KEY ?? "";
    if (!key || key === "replace-me") {
      checks.push({
        label: "Claude API key",
        status: "fail",
        fix: "Run: pnpm manasvi models add claude"
      });
    } else {
      const claudeOk = await checkAnthropic(config.model.claudeBaseUrl, key);
      checks.push({
        label: "Claude reachable",
        status: claudeOk ? "pass" : "fail",
        detail: config.model.claudeBaseUrl,
        fix: claudeOk ? undefined : "Verify ANTHROPIC_API_KEY and network access"
      });
    }
  }
  if (config.model.provider === "deepseek") {
    const env = await readEnvFile(envPath);
    const key = env.DEEPSEEK_API_KEY ?? "";
    if (!key || key === "replace-me") {
      checks.push({
        label: "DeepSeek API key",
        status: "fail",
        fix: "Fix: set DEEPSEEK_API_KEY"
      });
    } else {
      const deepseekOk = await checkDeepSeek(config.model.deepseekBaseUrl, key);
      checks.push({
        label: "DeepSeek reachable",
        status: deepseekOk ? "pass" : "fail",
        detail: config.model.deepseekBaseUrl,
        fix: deepseekOk ? undefined : "Verify DEEPSEEK_API_KEY, DEEPSEEK_BASE_URL, and network access"
      });
    }
  }

  // ── Core services health ──────────────────────────────────────────────────────

  const serviceHealth = await checkAllServices(config);
  const healthy = serviceHealth.filter((h) => h.status === "healthy");
  const down = serviceHealth.filter((h) => h.status !== "healthy");

  if (down.length === serviceHealth.length) {
    checks.push({
      label: "Services running",
      status: "warn",
      detail: "No services are running",
      fix: "Run: pnpm manasvi start"
    });
  } else if (down.length > 0) {
    checks.push({
      label: `Services running (${healthy.length}/${serviceHealth.length})`,
      status: "warn",
      detail: `Down: ${down.map((h) => h.label).join(", ")}`,
      fix: "Run: pnpm manasvi start"
    });
  } else {
    checks.push({ label: "All services healthy", status: "pass" });
  }

  return checks;
}

export async function runDoctor(): Promise<void> {
  banner("doctor");
  info("Running diagnostics…");
  console.log();

  const config = await loadConfig();
  const checks = await runChecks(config);

  section("Checks");
  for (const check of checks) {
    checkRow(check.label, check.status, check.detail);
  }

  const failed = checks.filter((c) => c.status === "fail");
  const warned = checks.filter((c) => c.status === "warn");

  console.log();

  if (failed.length > 0) {
    section("Issues to fix");
    for (const c of failed) {
      printError(c.label);
      if (c.fix) hint(`  Fix: ${c.fix}`);
    }
  }

  if (warned.length > 0) {
    section("Warnings");
    for (const c of warned) {
      warn(c.label);
      if (c.fix) hint(`  ${c.fix}`);
    }
  }

  if (failed.length === 0 && warned.length === 0) {
    success("Everything looks good!");
  }

  console.log();
}
