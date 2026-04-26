/**
 * manasvi channels <list|add|status|remove|logs>
 */

import { banner, section, info, success, warn, hint, table, step, style } from "../lib/ui.js";
import { select, confirm, input, secret } from "../lib/prompt.js";
import { loadConfig, saveConfig } from "../lib/config.js";
import { envFilePath, mergeEnvFile, readEnvFile } from "../lib/env.js";
import { isPortInUse } from "../lib/health.js";
import { tailServiceLog } from "../lib/services.js";

// ── List ──────────────────────────────────────────────────────────────────────

export async function runChannelsList(): Promise<void> {
  banner("channels");

  const config = await loadConfig();
  if (!config?.initialized) { warn("Run `pnpm manasvi init` first"); return; }

  section("Configured channels");

  const tg = config.channels.telegram;
  const sl = config.channels.slack;

  const channels = [
    {
      name: "Telegram",
      key: "telegram",
      enabled: tg?.enabled ?? false,
      description: tg?.enabled
        ? `${tg.mode ?? "polling"} mode`
        : "not configured"
    },
    {
      name: "Slack",
      key: "slack",
      enabled: sl?.enabled ?? false,
      description: sl?.enabled ? "Events API" : "not configured"
    },
    {
      name: "Terminal / API",
      key: "webui",
      enabled: true,
      description: `http://localhost:${config.services.gatewayPort}/test-harness/chat`
    }
  ];

  for (const ch of channels) {
    const statusIcon = ch.enabled ? style.green("●") : style.dim("○");
    const statusLabel = ch.enabled ? style.green("enabled") : style.dim("disabled");
    console.log(`  ${statusIcon} ${ch.name.padEnd(14)}  ${statusLabel}  ${style.dim(ch.description)}`);
  }

  console.log();
  hint("Add a channel: pnpm manasvi channels add <telegram|slack>");
  console.log();
}

// ── Add ───────────────────────────────────────────────────────────────────────

export async function runChannelsAdd(channelName?: string): Promise<void> {
  banner("channels add");

  const config = await loadConfig();
  if (!config?.initialized) { warn("Run `pnpm manasvi init` first"); return; }

  if (!channelName) {
    channelName = await select("Which channel to add?", [
      { value: "telegram", label: "Telegram", description: "Bot API — polling (local) or webhook (production)" },
      { value: "slack", label: "Slack", description: "Workspace integration via Events API" }
    ]);
  }

  const envPath = envFilePath(config.projectPath);
  const existingEnv = await readEnvFile(envPath);

  // ── Telegram ─────────────────────────────────────────────────────────────────

  if (channelName === "telegram") {
    info("To get a bot token: open Telegram → search @BotFather → /newbot");
    hint("BotFather gives you a token like:  7123456789:AAEOm3xyzABCdef...");
    hint("Keep your token safe — it lets Manasvi send messages as your bot.");
    console.log();

    const existingToken = existingEnv.TELEGRAM_BOT_TOKEN ?? "";
    const token = existingToken || await secret("Telegram bot token");

    if (!token) { warn("No token provided — aborting"); return; }

    // Mode selection
    const existingMode = config.channels.telegram?.mode ?? "polling";
    const modeChoice = await select(
      "How should Manasvi receive Telegram messages?",
      [
        {
          value: "polling",
          label: "Polling mode (recommended for local)",
          description: "Manasvi checks Telegram for new messages — no public URL needed"
        },
        {
          value: "webhook",
          label: "Webhook mode (for public servers)",
          description: "Telegram pushes messages to your server — requires a public HTTPS URL"
        }
      ],
      existingMode === "polling" ? 0 : 1
    );
    const mode = modeChoice as "polling" | "webhook";

    const envUpdates: Record<string, string> = {};
    if (token !== existingToken) envUpdates.TELEGRAM_BOT_TOKEN = token;

    let webhookUrl: string | undefined;

    if (mode === "polling") {
      info("Polling mode — Manasvi will automatically check Telegram for updates.");
      hint("No public URL or webhook setup required.");
      hint("Polling starts automatically when you run: pnpm manasvi start");
      envUpdates.TELEGRAM_ADAPTER_MODE = "polling";
    } else {
      info("Webhook mode — Telegram will push updates to your public URL.");
      hint("You need a publicly reachable HTTPS server (e.g., use ngrok for local testing).");
      const existingWebhookUrl = existingEnv.TELEGRAM_WEBHOOK_URL ?? config.channels.telegram?.webhookUrl ?? "";
      webhookUrl = await input("Public HTTPS base URL (e.g., https://abc123.ngrok-free.app)", existingWebhookUrl);
      if (!webhookUrl) { warn("No webhook URL provided — aborting"); return; }

      const existingSecret = existingEnv.TELEGRAM_WEBHOOK_SECRET ?? "";
      if (!existingSecret) {
        const webhookSecret = await secret("Webhook secret (optional, press Enter to skip)");
        if (webhookSecret) envUpdates.TELEGRAM_WEBHOOK_SECRET = webhookSecret;
      }

      envUpdates.TELEGRAM_ADAPTER_MODE = "webhook";
      if (webhookUrl) envUpdates.TELEGRAM_WEBHOOK_URL = webhookUrl;

      info("Register the webhook with Telegram:");
      console.log(style.dim(`
  curl -X POST "${config.services.ingressPort ? `http://localhost:${config.services.ingressPort}` : "http://localhost:4101"}/ingress/telegram/set-webhook" \\
    -H "Content-Type: application/json" \\
    -d '{"webhookUrl":"${webhookUrl}/ingress/telegram/webhook"}'
      `.trim()));
      hint("Or run this after starting Manasvi services.");
    }

    config.channels.telegram = {
      enabled: true,
      mode,
      ...(webhookUrl ? { webhookUrl } : {})
    };
    await saveConfig(config);

    if (Object.keys(envUpdates).length > 0) {
      await mergeEnvFile(envPath, envUpdates, { force: Object.keys(envUpdates) });
    }

    console.log();
    success("Telegram channel configured");
    if (mode === "polling") {
      hint("Run `pnpm manasvi start` — polling begins automatically");
      hint("Check status: pnpm manasvi channels status");
    } else {
      hint("Run `pnpm manasvi start`, then register the webhook shown above");
      hint("Check status: pnpm manasvi channels status");
    }
  }

  // ── Slack ─────────────────────────────────────────────────────────────────────

  if (channelName === "slack") {
    info("You need a Slack app with Events API enabled.");
    info("Create one at: https://api.slack.com/apps");
    hint("Required scopes: app_mentions:read, chat:write, im:history, im:read");
    console.log();

    const botToken = existingEnv.SLACK_BOT_TOKEN ?? "";
    const signingSecret = existingEnv.SLACK_SIGNING_SECRET ?? "";

    const newBotToken = botToken || await secret("Slack bot token (xoxb-...)");
    const newSigningSecret = signingSecret || await secret("Slack signing secret");

    if (!newBotToken || !newSigningSecret) { warn("Incomplete credentials — aborting"); return; }

    config.channels.slack = { enabled: true };
    await saveConfig(config);

    const updates: Record<string, string> = {};
    if (newBotToken !== botToken) updates.SLACK_BOT_TOKEN = newBotToken;
    if (newSigningSecret !== signingSecret) updates.SLACK_SIGNING_SECRET = newSigningSecret;
    if (Object.keys(updates).length > 0) {
      await mergeEnvFile(envPath, updates, { force: Object.keys(updates) });
    }

    success("Slack channel configured");
    hint("Slack requires a public webhook URL for event delivery.");
    hint("Restart services to apply: pnpm manasvi restart");
  }

  console.log();
}

// ── Status ────────────────────────────────────────────────────────────────────

export async function runChannelsStatus(): Promise<void> {
  banner("channels status");

  const config = await loadConfig();
  if (!config?.initialized) { warn("Run `pnpm manasvi init` first"); return; }

  const envPath = envFilePath(config.projectPath);
  const env = await readEnvFile(envPath);
  const ingressRunning = await isPortInUse(config.services.ingressPort);

  // Fetch live Telegram adapter status from ingress if it's running
  type LiveTelegramStatus = {
    configured: boolean;
    mode?: string;
    poller?: {
      running: boolean;
      updatesReceived: number;
      lastPollAt: string | null;
      lastUpdateAt: string | null;
      lastError: string | null;
      consecutiveErrors: number;
    } | null;
  };
  let liveStatus: LiveTelegramStatus | null = null;

  if (ingressRunning) {
    try {
      const res = await fetch(`http://localhost:${config.services.ingressPort}/ingress/telegram/status`);
      if (res.ok) {
        liveStatus = (await res.json()) as LiveTelegramStatus;
      }
    } catch {
      // ingress is up but status endpoint unreachable — don't fail
    }
  }

  // ── Telegram ─────────────────────────────────────────────────────────────────

  section("Telegram");

  const telegramEnabled = config.channels.telegram?.enabled ?? false;
  const telegramMode = config.channels.telegram?.mode ?? "polling";
  const hasTelegramToken = !!(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_BOT_TOKEN !== "replace-me" && env.TELEGRAM_BOT_TOKEN !== "");

  const rows = [
    {
      label: "Configured",
      value: telegramEnabled ? "yes" : "no",
      status: (telegramEnabled ? "ok" : "dim") as "ok" | "dim" | "warn" | "error"
    },
    {
      label: "Mode",
      value: telegramEnabled ? telegramMode : "—",
      status: "dim" as const
    },
    {
      label: "Bot token",
      value: hasTelegramToken ? "set" : "missing",
      status: (hasTelegramToken ? "ok" : (telegramEnabled ? "error" : "dim")) as "ok" | "dim" | "warn" | "error"
    },
    {
      label: "Ingress service",
      value: ingressRunning ? "running" : "stopped",
      status: (ingressRunning ? "ok" : "warn") as "ok" | "warn" | "error" | "dim"
    }
  ];

  if (liveStatus?.poller) {
    const p = liveStatus.poller;
    rows.push({
      label: "Polling loop",
      value: p.running ? "active" : "stopped",
      status: (p.running ? "ok" : "warn") as "ok" | "warn" | "error" | "dim"
    });
    rows.push({
      label: "Updates received",
      value: String(p.updatesReceived),
      status: "dim" as const
    });
    if (p.lastUpdateAt) {
      rows.push({
        label: "Last update",
        value: new Date(p.lastUpdateAt).toLocaleTimeString(),
        status: "dim" as const
      });
    }
    if (p.lastError) {
      rows.push({
        label: "Last error",
        value: p.lastError,
        status: "error" as const
      });
    }
    if (p.consecutiveErrors > 0) {
      rows.push({
        label: "Consecutive errors",
        value: String(p.consecutiveErrors),
        status: (p.consecutiveErrors >= 3 ? "error" : "warn") as "ok" | "warn" | "error" | "dim"
      });
    }
  }

  table(rows);

  console.log();

  if (telegramEnabled && hasTelegramToken && ingressRunning && liveStatus?.poller?.running) {
    success("Telegram is active and polling for messages");
    hint("Send a message to your bot to test the connection");
  } else if (telegramEnabled && hasTelegramToken && ingressRunning && telegramMode === "webhook") {
    success("Telegram webhook mode configured — ingress service is ready");
    hint("Make sure the webhook is registered: pnpm manasvi channels add telegram (to see the curl command)");
  } else if (telegramEnabled && hasTelegramToken && !ingressRunning) {
    warn("Telegram is configured but services are not running");
    hint("Start with: pnpm manasvi start");
  } else if (telegramEnabled && !hasTelegramToken) {
    warn("Telegram is enabled but the bot token is missing");
    hint("Fix with: pnpm manasvi channels add telegram");
  } else if (!telegramEnabled) {
    info("Telegram not configured. Add it with: pnpm manasvi channels add telegram");
  } else if (ingressRunning && liveStatus?.poller && !liveStatus.poller.running) {
    warn("Telegram is configured but the polling loop is not running");
    hint("Check ingress service logs: pnpm manasvi channels logs ingress-service");
    if (liveStatus.poller.consecutiveErrors >= 3) {
      warn(`Last error: ${liveStatus.poller.lastError ?? "unknown"}`);
      hint("This usually means the bot token is invalid or Telegram is unreachable");
    }
  }

  // ── Slack ─────────────────────────────────────────────────────────────────────

  section("Slack");

  const slackEnabled = config.channels.slack?.enabled ?? false;
  const hasSlackToken = !!(env.SLACK_BOT_TOKEN && env.SLACK_BOT_TOKEN !== "");
  const hasSlackSecret = !!(env.SLACK_SIGNING_SECRET && env.SLACK_SIGNING_SECRET !== "");

  table([
    {
      label: "Configured",
      value: slackEnabled ? "yes" : "no",
      status: (slackEnabled ? "ok" : "dim") as "ok" | "dim" | "warn" | "error"
    },
    {
      label: "Bot token",
      value: hasSlackToken ? "set" : "missing",
      status: (hasSlackToken ? "ok" : (slackEnabled ? "error" : "dim")) as "ok" | "dim" | "warn" | "error"
    },
    {
      label: "Signing secret",
      value: hasSlackSecret ? "set" : "missing",
      status: (hasSlackSecret ? "ok" : (slackEnabled ? "error" : "dim")) as "ok" | "dim" | "warn" | "error"
    }
  ]);

  if (!slackEnabled) {
    console.log();
    info("Slack not configured. Add it with: pnpm manasvi channels add slack");
  }

  console.log();
}

// ── Remove ────────────────────────────────────────────────────────────────────

export async function runChannelsRemove(channelName?: string): Promise<void> {
  banner("channels remove");

  const config = await loadConfig();
  if (!config?.initialized) { warn("Run `pnpm manasvi init` first"); return; }

  if (!channelName) {
    channelName = await select("Which channel to remove?", [
      { value: "telegram", label: "Telegram" },
      { value: "slack", label: "Slack" }
    ]);
  }

  const confirmed = await confirm(`Remove ${channelName} channel configuration?`, false);
  if (!confirmed) { info("Cancelled"); return; }

  if (channelName === "telegram") {
    config.channels.telegram = { enabled: false, mode: "polling" };
  } else if (channelName === "slack") {
    config.channels.slack = { enabled: false };
  }

  await saveConfig(config);
  success(`${channelName} channel disabled`);
  hint("Restart services to apply: pnpm manasvi restart");
  console.log();
}

// ── Logs ──────────────────────────────────────────────────────────────────────

export async function runChannelsLogs(serviceName?: string): Promise<void> {
  const target = serviceName ?? "ingress-service";
  const tail = await tailServiceLog(target);
  console.log(style.dim(`\n── ${target} logs (last 30 lines) ──\n`));
  console.log(tail);
  console.log();
}
