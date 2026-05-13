/**
 * manasvi doctor
 * Diagnoses common setup problems with actionable fixes.
 * Supports: --fix (safe auto-repair), --category <name>, --json
 */

import { execSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { banner, section, checkRow, warn, success, info, hint, error as printError, style } from "../lib/ui.js";
import { loadConfig, cliHomePath, logsDir, pidFilePath } from "../lib/config.js";
import { fileExists, envFilePath, readEnvFile } from "../lib/env.js";
import { checkAllServices, checkAnthropic, checkDeepSeek, checkOllama, checkOpenAI, isPortInUse } from "../lib/health.js";
import { printJson, jsonOk, jsonFail, type CliError, type CliWarning } from "../lib/json.js";

export type CheckStatus = "pass" | "warn" | "fail" | "skip";

export type CheckCategory =
  | "system"
  | "config"
  | "secrets"
  | "models"
  | "channels"
  | "services"
  | "security";

export interface Check {
  label: string;
  category: CheckCategory;
  status: CheckStatus;
  detail?: string;
  fix?: string;
  safeAutoFix?: () => Promise<void>;
}

export interface DoctorOptions {
  fix?: boolean;
  category?: string;
  json?: boolean;
}

// ── Check runners ──────────────────────────────────────────────────────────────

async function runChecks(config: Awaited<ReturnType<typeof loadConfig>>): Promise<Check[]> {
  const checks: Check[] = [];
  const homeDir = cliHomePath();
  const logDir = logsDir();
  const pidFile = pidFilePath();

  // ── System ───────────────────────────────────────────────────────────────────

  const nodeMajor = parseInt(process.version.slice(1).split(".")[0] ?? "0", 10);
  checks.push({
    label: "Node.js ≥ 20",
    category: "system",
    status: nodeMajor >= 20 ? "pass" : "fail",
    detail: process.version,
    fix: nodeMajor < 20 ? "Install Node.js 20+ from https://nodejs.org" : undefined
  });

  try {
    execSync("pnpm --version", { stdio: "ignore" });
    checks.push({ label: "pnpm installed", category: "system", status: "pass" });
  } catch {
    checks.push({ label: "pnpm installed", category: "system", status: "fail", fix: "Run: corepack enable" });
  }

  const homeExists = await fileExists(homeDir);
  checks.push({
    label: "CLI home (~/.manasvi)",
    category: "system",
    status: homeExists ? "pass" : "fail",
    detail: homeDir,
    fix: homeExists ? undefined : "Run: pnpm manasvi init",
    safeAutoFix: homeExists ? undefined : async () => {
      await mkdir(homeDir, { recursive: true });
    }
  });

  const logDirExists = await fileExists(logDir);
  checks.push({
    label: "Logs directory",
    category: "system",
    status: logDirExists ? "pass" : "warn",
    detail: logDir,
    fix: logDirExists ? undefined : "Will be created automatically on start",
    safeAutoFix: logDirExists ? undefined : async () => {
      await mkdir(logDir, { recursive: true });
    }
  });

  // ── Config ───────────────────────────────────────────────────────────────────

  const configExists = await fileExists(join(homeDir, "config.json"));
  checks.push({
    label: "CLI config file",
    category: "config",
    status: configExists ? "pass" : "fail",
    fix: configExists ? undefined : "Run: pnpm manasvi init"
  });

  if (!config?.initialized) {
    checks.push({
      label: "Manasvi initialized",
      category: "config",
      status: "fail",
      fix: "Run: pnpm manasvi init"
    });
    return checks;
  }

  checks.push({ label: "Manasvi initialized", category: "config", status: "pass" });
  checks.push({ label: "Onboarded", category: "config", status: config.onboarded ? "pass" : "warn",
    fix: config.onboarded ? undefined : "Run: pnpm manasvi onboard" });

  // ── Secrets ──────────────────────────────────────────────────────────────────

  const envPath = envFilePath(config.projectPath);
  const envExists = await fileExists(envPath);
  checks.push({
    label: ".env.local exists",
    category: "secrets",
    status: envExists ? "pass" : "fail",
    detail: envPath,
    fix: envExists ? undefined : "Run: pnpm manasvi init"
  });

  let env: Record<string, string> = {};
  if (envExists) {
    env = await readEnvFile(envPath);

    const requiredSecrets = [
      "INTERNAL_AUTH_KEY_ID",
      "INTERNAL_AUTH_SIGNING_SECRET",
      "APPROVAL_SIGNING_KEYS",
      "APPROVAL_VERIFICATION_KEYS"
    ];

    const missing = requiredSecrets.filter((k) => !env[k] || env[k] === "replace-me");
    checks.push({
      label: "Required internal secrets",
      category: "secrets",
      status: missing.length === 0 ? "pass" : "fail",
      detail: missing.length > 0 ? `Missing: ${missing.join(", ")}` : `${requiredSecrets.length} secrets present`,
      fix: missing.length > 0 ? "Run: pnpm manasvi init --force" : undefined
    });

    // Security: filesystem writes
    const fsWritesEnabled = (env.MANASVI_FS_WRITES_ENABLED ?? "false").toLowerCase() === "true";
    const fsWritesRequireApproval = (env.MANASVI_FS_WRITES_REQUIRE_APPROVAL ?? "true").toLowerCase() === "true";
    checks.push({
      label: "Filesystem writes",
      category: "security",
      status: fsWritesEnabled ? "warn" : "pass",
      detail: fsWritesEnabled ? "enabled" : "disabled (safe)"
    });
    if (fsWritesEnabled && !fsWritesRequireApproval) {
      checks.push({
        label: "FS write approval required",
        category: "security",
        status: "fail",
        detail: "MANASVI_FS_WRITES_REQUIRE_APPROVAL=false — writes enabled without approval is unsafe",
        fix: "Set MANASVI_FS_WRITES_REQUIRE_APPROVAL=true in .env.local"
      });
    } else {
      checks.push({
        label: "FS write approval required",
        category: "security",
        status: "pass",
        detail: fsWritesRequireApproval ? "true" : "N/A (writes disabled)"
      });
    }
  }

  // ── Models ───────────────────────────────────────────────────────────────────

  if (envExists) {
    const modelMode = env.MODEL_ADAPTER_MODE ?? env.MANASVI_MODEL_PROVIDER ?? "deepseek";
    const modelName = env.PLANNER_MODEL ?? env.MANASVI_MODEL ?? "deepseek-v4-flash";
    checks.push({ label: "Model provider", category: "models", status: "pass", detail: modelMode });
    checks.push({ label: "Model name", category: "models", status: "pass", detail: modelName });

    if (modelMode === "deepseek") {
      const hasKey = env.DEEPSEEK_API_KEY && env.DEEPSEEK_API_KEY !== "replace-me";
      if (!hasKey) {
        checks.push({ label: "DeepSeek API key", category: "models", status: "fail", detail: "missing",
          fix: "Run: pnpm manasvi models add deepseek" });
      } else {
        const ok = await checkDeepSeek(config.model.deepseekBaseUrl, env.DEEPSEEK_API_KEY!);
        checks.push({ label: "DeepSeek reachable", category: "models", status: ok ? "pass" : "fail",
          detail: config.model.deepseekBaseUrl,
          fix: ok ? undefined : "Verify DEEPSEEK_API_KEY and network access" });
      }
    }

    if (modelMode === "openai") {
      const hasKey = env.OPENAI_API_KEY && env.OPENAI_API_KEY !== "replace-me";
      if (!hasKey) {
        checks.push({ label: "OpenAI API key", category: "models", status: "fail", detail: "missing",
          fix: "Run: pnpm manasvi models add openai" });
      } else {
        const ok = await checkOpenAI(config.model.openaiBaseUrl, env.OPENAI_API_KEY!);
        checks.push({ label: "OpenAI reachable", category: "models", status: ok ? "pass" : "fail",
          detail: config.model.openaiBaseUrl,
          fix: ok ? undefined : "Verify OPENAI_API_KEY and network access" });
      }
    }

    if (modelMode === "claude") {
      const hasKey = env.ANTHROPIC_API_KEY && env.ANTHROPIC_API_KEY !== "replace-me";
      if (!hasKey) {
        checks.push({ label: "Anthropic API key", category: "models", status: "fail", detail: "missing",
          fix: "Run: pnpm manasvi models add claude" });
      } else {
        const ok = await checkAnthropic(config.model.claudeBaseUrl, env.ANTHROPIC_API_KEY!);
        checks.push({ label: "Claude reachable", category: "models", status: ok ? "pass" : "fail",
          detail: config.model.claudeBaseUrl,
          fix: ok ? undefined : "Verify ANTHROPIC_API_KEY and network access" });
      }
    }

    if (modelMode === "ollama") {
      const ollamaOk = await checkOllama(config.model.ollamaBaseUrl);
      checks.push({ label: "Ollama reachable", category: "models", status: ollamaOk ? "pass" : "fail",
        detail: config.model.ollamaBaseUrl,
        fix: ollamaOk ? undefined : "Start Ollama: ollama serve" });

      if (ollamaOk) {
        try {
          const url = config.model.ollamaBaseUrl.replace(/\/v1\/?$/, "");
          const res = await fetch(`${url}/api/tags`, { signal: AbortSignal.timeout(3000) });
          const data = (await res.json()) as { models?: Array<{ name: string }> };
          const models = data.models?.map((m) => m.name) ?? [];
          const modelName2 = config.model.ollamaModel;
          const hasModel = models.some((m) => m.includes(modelName2.split(":")[0] ?? ""));
          checks.push({ label: `Ollama model (${modelName2})`, category: "models",
            status: hasModel ? "pass" : "warn", detail: hasModel ? "available" : "not found",
            fix: hasModel ? undefined : `Run: ollama pull ${modelName2}` });
        } catch {
          checks.push({ label: "Ollama model check", category: "models", status: "skip", detail: "could not list models" });
        }
      }
    }
  }

  // ── Channels ──────────────────────────────────────────────────────────────────

  if (envExists) {
    const telegramToken = env.TELEGRAM_BOT_TOKEN;
    const telegramMode = env.TELEGRAM_ADAPTER_MODE ?? "polling";
    const telegramEnabled = config.channels.telegram?.enabled;

    if (telegramEnabled || (telegramToken && telegramToken !== "replace-me")) {
      if (!telegramToken || telegramToken === "replace-me") {
        checks.push({ label: "Telegram bot token", category: "channels", status: "fail",
          detail: "missing", fix: "Run: pnpm manasvi channels add telegram" });
      } else {
        const tokenFormatOk = /^\d{8,12}:[A-Za-z0-9_-]{35,}$/.test(telegramToken);
        checks.push({ label: "Telegram bot token", category: "channels",
          status: tokenFormatOk ? "pass" : "warn",
          detail: tokenFormatOk ? `mode: ${telegramMode}` : "Token format looks unexpected",
          fix: tokenFormatOk ? undefined : "Run: pnpm manasvi channels add telegram" });
      }

      if (telegramMode === "webhook") {
        const webhookUrl = env.TELEGRAM_WEBHOOK_URL;
        checks.push({ label: "Telegram webhook URL", category: "channels",
          status: webhookUrl && webhookUrl !== "replace-me" ? "pass" : "fail",
          detail: webhookUrl || "TELEGRAM_WEBHOOK_URL not set",
          fix: webhookUrl ? undefined : "Set TELEGRAM_WEBHOOK_URL in .env.local" });
      }
    } else {
      checks.push({ label: "Telegram", category: "channels", status: "skip", detail: "not configured" });
    }

    const slackToken = env.SLACK_BOT_TOKEN;
    if (config.channels.slack?.enabled || slackToken) {
      checks.push({ label: "Slack bot token", category: "channels",
        status: slackToken && slackToken !== "" ? "pass" : "fail",
        fix: "Run: pnpm manasvi channels add slack" });
    } else {
      checks.push({ label: "Slack", category: "channels", status: "skip", detail: "not configured" });
    }
  }

  // ── Port / services ───────────────────────────────────────────────────────────

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
      label: `${name} (port ${port})`,
      category: "services",
      status: inUse ? "pass" : "warn",
      detail: inUse ? "responding" : "not running",
      fix: inUse ? undefined : "Run: pnpm manasvi start"
    });
  }

  const serviceHealth = await checkAllServices(config);
  const healthy = serviceHealth.filter((h) => h.status === "healthy");
  const down = serviceHealth.filter((h) => h.status !== "healthy");

  if (down.length === serviceHealth.length) {
    checks.push({ label: "Services", category: "services", status: "warn",
      detail: "No services running", fix: "Run: pnpm manasvi start" });
  } else if (down.length > 0) {
    checks.push({ label: `Services (${healthy.length}/${serviceHealth.length} healthy)`,
      category: "services", status: "warn",
      detail: `Down: ${down.map((h) => h.label).join(", ")}`,
      fix: "Run: pnpm manasvi start" });
  } else {
    checks.push({ label: "All services healthy", category: "services", status: "pass" });
  }

  return checks;
}

// ── Safe auto-fixes ────────────────────────────────────────────────────────────

async function runSafeFixes(checks: Check[]): Promise<string[]> {
  const fixable = checks.filter((c) => c.status !== "pass" && c.safeAutoFix);
  const applied: string[] = [];
  for (const check of fixable) {
    try {
      await check.safeAutoFix!();
      applied.push(check.label);
    } catch {
      // fix failed — leave it for manual action
    }
  }
  return applied;
}

// ── Main ──────────────────────────────────────────────────────────────────────

export async function runDoctor(opts: DoctorOptions = {}): Promise<void> {
  const config = await loadConfig();
  let checks = await runChecks(config);

  // Filter by category
  if (opts.category) {
    const cat = opts.category.toLowerCase() as CheckCategory;
    checks = checks.filter((c) => c.category === cat);
    if (checks.length === 0) {
      const validCategories = "system | config | secrets | models | channels | services | security";
      if (opts.json) {
        printJson(jsonFail("doctor", [{ code: "invalid_category", message: `Unknown category: ${cat}`, fix: `Valid: ${validCategories}` }]));
      } else {
        warn(`No checks found for category: ${cat}`);
        hint(`Valid categories: ${validCategories}`);
      }
      process.exit(1);
    }
  }

  // Run auto-fix if requested
  let fixesApplied: string[] = [];
  if (opts.fix) {
    fixesApplied = await runSafeFixes(checks);
    // Re-run checks after fixes
    const refreshed = await runChecks(config);
    checks = opts.category
      ? refreshed.filter((c) => c.category === opts.category?.toLowerCase())
      : refreshed;
  }

  const failed = checks.filter((c) => c.status === "fail");
  const warned = checks.filter((c) => c.status === "warn");

  // JSON output
  if (opts.json) {
    const errors: CliError[] = failed.map((c) => ({
      code: `doctor.${c.category}.fail`,
      message: c.label + (c.detail ? `: ${c.detail}` : ""),
      fix: c.fix
    }));
    const warnings: CliWarning[] = warned.map((c) => ({
      code: `doctor.${c.category}.warn`,
      message: c.label + (c.detail ? `: ${c.detail}` : "")
    }));

    const response = errors.length > 0
      ? jsonFail("doctor", errors, {
          checks: checks.map((c) => ({
            label: c.label,
            category: c.category,
            status: c.status,
            detail: c.detail,
            fix: c.fix
          })),
          summary: { pass: checks.filter((c) => c.status === "pass").length, warn: warned.length, fail: failed.length },
          fixesApplied
        }, {
          warnings,
          nextSteps: failed.map((c) => c.fix).filter(Boolean) as string[]
        })
      : jsonOk("doctor", {
          checks: checks.map((c) => ({
            label: c.label,
            category: c.category,
            status: c.status,
            detail: c.detail
          })),
          summary: { pass: checks.filter((c) => c.status === "pass").length, warn: warned.length, fail: 0 },
          fixesApplied
        }, { warnings });

    printJson(response);
    if (failed.length > 0) process.exit(1);
    return;
  }

  // Human output
  banner("doctor");
  info("Running diagnostics…");
  console.log();

  // Group by category
  const categoryOrder: CheckCategory[] = ["system", "config", "secrets", "models", "channels", "services", "security"];
  const categoryLabels: Record<CheckCategory, string> = {
    system: "System",
    config: "Configuration",
    secrets: "Secrets",
    models: "Model Provider",
    channels: "Channels",
    services: "Services",
    security: "Security"
  };

  const grouped = new Map<CheckCategory, Check[]>();
  for (const check of checks) {
    const list = grouped.get(check.category) ?? [];
    list.push(check);
    grouped.set(check.category, list);
  }

  for (const cat of categoryOrder) {
    const catChecks = grouped.get(cat);
    if (!catChecks?.length) continue;
    section(categoryLabels[cat]);
    for (const check of catChecks) {
      checkRow(check.label, check.status, check.detail);
    }
  }

  console.log();

  if (fixesApplied.length > 0) {
    section("Auto-fixes applied");
    for (const f of fixesApplied) {
      success(f);
    }
    console.log();
  }

  if (failed.length > 0) {
    section("Issues to fix");
    for (const c of failed) {
      printError(c.label + (c.detail ? `: ${c.detail}` : ""));
      if (c.fix) hint(`  Fix: ${c.fix}`);
    }
    console.log();
  }

  if (warned.length > 0 && failed.length === 0) {
    section("Warnings");
    for (const c of warned) {
      warn(c.label + (c.detail ? `: ${c.detail}` : ""));
      if (c.fix) hint(`  ${c.fix}`);
    }
    console.log();
  }

  if (failed.length === 0 && warned.length === 0) {
    success("All checks passed.");
  } else if (failed.length === 0) {
    success(`${checks.filter((c) => c.status === "pass").length} checks passed, ${warned.length} warning(s).`);
    hint("Warnings are non-critical but worth reviewing.");
  } else {
    warn(`${failed.length} issue(s) found. See fixes above.`);
    if (!opts.fix) {
      hint("Run `pnpm manasvi doctor --fix` to apply safe automatic fixes.");
    }
  }

  console.log();
}
