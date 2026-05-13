/**
 * manasvi connections
 * Unified status of all configured connections: models, channels, Google integrations.
 */

import { banner, section, info, success, warn, hint, style } from "../lib/ui.js";
import { loadConfig } from "../lib/config.js";
import { fileExists, envFilePath, readEnvFile } from "../lib/env.js";
import { checkOllama, checkDeepSeek, isPortInUse } from "../lib/health.js";
import { printJson, jsonOk } from "../lib/json.js";

export interface ConnectionsOptions {
  json?: boolean;
}

export async function runConnections(opts: ConnectionsOptions = {}): Promise<void> {
  const config = await loadConfig();

  if (!opts.json) {
    banner("connections");
  }

  if (!config?.initialized) {
    if (opts.json) {
      printJson(jsonOk("connections", { initialized: false, connections: [] }));
      return;
    }
    warn("Manasvi is not initialized. Run: pnpm manasvi init");
    return;
  }

  const envPath = envFilePath(config.projectPath);
  const envExists = await fileExists(envPath);
  const env = envExists ? await readEnvFile(envPath) : {};

  // ── Model status ──────────────────────────────────────────────────────────────

  const provider = config.model.provider;
  let modelStatus: "connected" | "not-configured" | "unreachable" | "key-missing" = "not-configured";
  let modelDetail = "";

  if (provider === "mock") {
    modelStatus = "connected";
    modelDetail = "mock (testing only)";
  } else if (provider === "ollama") {
    const ok = await checkOllama(config.model.ollamaBaseUrl);
    modelStatus = ok ? "connected" : "unreachable";
    modelDetail = `Ollama / ${config.model.ollamaModel} @ ${config.model.ollamaBaseUrl}`;
  } else if (provider === "deepseek") {
    const key = env.DEEPSEEK_API_KEY;
    if (!key || key === "replace-me") {
      modelStatus = "key-missing";
      modelDetail = "DeepSeek — API key not set";
    } else {
      const ok = await checkDeepSeek(config.model.deepseekBaseUrl, key);
      modelStatus = ok ? "connected" : "unreachable";
      modelDetail = `DeepSeek / ${config.model.deepseekModel}`;
    }
  } else if (provider === "openai") {
    const key = env.OPENAI_API_KEY;
    modelStatus = key && key !== "replace-me" ? "connected" : "key-missing";
    modelDetail = `OpenAI / ${config.model.openaiModel}`;
  } else if (provider === "claude") {
    const key = env.ANTHROPIC_API_KEY;
    modelStatus = key && key !== "replace-me" ? "connected" : "key-missing";
    modelDetail = `Claude / ${config.model.claudeModel}`;
  }

  // ── Channel status ────────────────────────────────────────────────────────────

  const telegramEnabled = config.channels.telegram?.enabled ?? false;
  const telegramMode = config.channels.telegram?.mode ?? "polling";
  const hasTelegramToken = !!(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_BOT_TOKEN !== "replace-me");
  const ingressRunning = await isPortInUse(config.services.ingressPort);

  const slackEnabled = config.channels.slack?.enabled ?? false;
  const hasSlackToken = !!(env.SLACK_BOT_TOKEN && env.SLACK_BOT_TOKEN !== "");

  // ── Google integration status ─────────────────────────────────────────────────

  const googleEnabled = config.integrations.google?.enabled ?? false;
  const googleScopes = config.integrations.google?.scopes ?? [];
  const hasGmailRead = googleScopes.some((s) => s.includes("gmail") && s.includes("readonly"));
  const hasCalendarRead = googleScopes.some((s) => s.includes("calendar") && s.includes("readonly"));
  const hasGmailWrite = googleScopes.some((s) => s.includes("gmail.modify") || s.includes("gmail.send") || s.includes("gmail.compose"));
  const hasCalendarWrite = googleScopes.some((s) => s.includes("calendar") && !s.includes("readonly"));

  if (opts.json) {
    printJson(jsonOk("connections", {
      model: {
        provider,
        status: modelStatus,
        detail: modelDetail
      },
      channels: {
        telegram: {
          enabled: telegramEnabled,
          mode: telegramMode,
          hasToken: hasTelegramToken,
          ingressRunning
        },
        slack: {
          enabled: slackEnabled,
          hasToken: hasSlackToken
        }
      },
      google: {
        enabled: googleEnabled,
        scopes: googleScopes,
        gmailRead: hasGmailRead,
        gmailWrite: hasGmailWrite,
        calendarRead: hasCalendarRead,
        calendarWrite: hasCalendarWrite
      }
    }));
    return;
  }

  // ── Human output ──────────────────────────────────────────────────────────────

  section("Model");

  const modelStatusIcon = {
    connected: style.green("✓"),
    "not-configured": style.dim("○"),
    unreachable: style.red("✗"),
    "key-missing": style.yellow("⚠")
  }[modelStatus];

  const modelStatusText = {
    connected: style.green("connected"),
    "not-configured": style.dim("not configured"),
    unreachable: style.red("unreachable"),
    "key-missing": style.yellow("API key missing")
  }[modelStatus];

  console.log(`  ${modelStatusIcon} ${style.dim("active:")} ${provider.padEnd(12)}  ${modelStatusText}  ${style.dim(modelDetail)}`);

  if (modelStatus === "key-missing") {
    hint(`  Fix: pnpm manasvi connect model`);
  } else if (modelStatus === "unreachable") {
    if (provider === "ollama") {
      hint(`  Fix: ollama serve`);
    } else {
      hint(`  Fix: pnpm manasvi doctor --category models`);
    }
  }

  section("Channels");

  const telegramStatusIcon = telegramEnabled
    ? (hasTelegramToken ? style.green("✓") : style.yellow("⚠"))
    : style.dim("○");
  const telegramStatusText = telegramEnabled
    ? (hasTelegramToken
        ? style.green(`${telegramMode} mode${ingressRunning ? " (active)" : " (service stopped)"}`)
        : style.yellow("token missing"))
    : style.dim("not configured");
  console.log(`  ${telegramStatusIcon} Telegram       ${telegramStatusText}`);

  if (telegramEnabled && !hasTelegramToken) {
    hint(`  Fix: pnpm manasvi connect telegram`);
  } else if (telegramEnabled && hasTelegramToken && !ingressRunning) {
    hint(`  Note: Start services to activate: pnpm manasvi start`);
  }

  const slackStatusIcon = slackEnabled
    ? (hasSlackToken ? style.green("✓") : style.yellow("⚠"))
    : style.dim("○");
  const slackStatusText = slackEnabled
    ? (hasSlackToken ? style.green("configured") : style.yellow("token missing"))
    : style.dim("not configured");
  console.log(`  ${slackStatusIcon} Slack          ${slackStatusText}`);

  if (slackEnabled && !hasSlackToken) {
    hint(`  Fix: pnpm manasvi connect slack`);
  }

  console.log(`  ${style.green("✓")} Terminal/API   ${style.green(`http://localhost:${config.services.gatewayPort}/test-harness/chat`)}`);

  section("Google Integrations");

  if (!googleEnabled) {
    console.log(`  ${style.dim("○")} Google         ${style.dim("not connected")}`);
    hint(`  Connect: pnpm manasvi connect google`);
  } else {
    const items = [
      { label: "Gmail read", ok: hasGmailRead },
      { label: "Gmail write", ok: hasGmailWrite },
      { label: "Calendar read", ok: hasCalendarRead },
      { label: "Calendar write", ok: hasCalendarWrite }
    ];
    for (const item of items) {
      const icon = item.ok ? style.green("✓") : style.dim("○");
      const text = item.ok ? style.green("connected") : style.dim("not authorized");
      console.log(`  ${icon} ${item.label.padEnd(18)}  ${text}`);
    }
    if (!hasGmailWrite || !hasCalendarWrite) {
      hint(`  Extend scopes: pnpm manasvi integrations add google write`);
    }
  }

  console.log();
  hint("Configure: pnpm manasvi connect <model|telegram|slack|google>");
  hint("Details:   pnpm manasvi integrations status");
  console.log();
}
