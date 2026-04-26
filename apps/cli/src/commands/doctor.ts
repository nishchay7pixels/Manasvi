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
import { checkAllServices, checkAnthropic, checkOllama, checkOpenAI, isPortInUse } from "../lib/health.js";

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
    const modelMode = env.MODEL_ADAPTER_MODE ?? "mock";
    checks.push({
      label: "Model adapter configured",
      status: "pass",
      detail: modelMode
    });

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
    if (telegramToken && telegramToken !== "replace-me") {
      checks.push({ label: "Telegram bot token set", status: "pass" });
    } else if (config.channels.telegram?.enabled) {
      checks.push({
        label: "Telegram bot token set",
        status: "warn",
        detail: "Channel is enabled but token is missing",
        fix: "Run: pnpm manasvi channels add telegram"
      });
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
