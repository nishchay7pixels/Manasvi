/**
 * manasvi channels <list|add|status|remove|logs>
 */

import { banner, section, info, success, warn, hint, table, step, style } from "../lib/ui.js";
import { select, confirm, input, secret } from "../lib/prompt.js";
import { loadConfig, saveConfig } from "../lib/config.js";
import { envFilePath, mergeEnvFile, readEnvFile } from "../lib/env.js";
import { isPortInUse } from "../lib/health.js";
import { tailServiceLog } from "../lib/services.js";

export async function runChannelsList(): Promise<void> {
  banner("channels");

  const config = await loadConfig();
  if (!config?.initialized) { warn("Run `pnpm manasvi init` first"); return; }

  section("Configured channels");

  const channels = [
    {
      name: "Telegram",
      key: "telegram",
      enabled: config.channels.telegram?.enabled ?? false,
      description: "Bot API via polling or webhook"
    },
    {
      name: "Slack",
      key: "slack",
      enabled: config.channels.slack?.enabled ?? false,
      description: "Slack Events API"
    },
    {
      name: "Web UI / API",
      key: "webui",
      enabled: true,
      description: `http://localhost:${config.services.gatewayPort}/test-harness/chat (always available)`
    }
  ];

  for (const ch of channels) {
    const statusIcon = ch.enabled ? style.green("●") : style.dim("○");
    const statusLabel = ch.enabled ? style.green("enabled") : style.dim("disabled");
    console.log(`  ${statusIcon} ${ch.name.padEnd(12)}  ${statusLabel}  ${style.dim(ch.description)}`);
  }

  console.log();
  hint("Add a channel: pnpm manasvi channels add <telegram|slack>");
  console.log();
}

export async function runChannelsAdd(channelName?: string): Promise<void> {
  banner("channels add");

  const config = await loadConfig();
  if (!config?.initialized) { warn("Run `pnpm manasvi init` first"); return; }

  if (!channelName) {
    channelName = await select("Which channel to add?", [
      { value: "telegram", label: "Telegram", description: "Bot API" },
      { value: "slack", label: "Slack", description: "Workspace integration" }
    ]);
  }

  const envPath = envFilePath(config.projectPath);
  const existingEnv = await readEnvFile(envPath);

  if (channelName === "telegram") {
    info("You need a Telegram bot token from @BotFather.");
    info("Create a bot: open Telegram, message @BotFather, then /newbot");
    console.log();

    const existingToken = existingEnv.TELEGRAM_BOT_TOKEN ?? "";
    const token = existingToken || await secret("Telegram bot token");

    if (!token) { warn("No token provided — aborting"); return; }

    config.channels.telegram = { enabled: true };
    await saveConfig(config);
    if (token !== existingToken) {
      await mergeEnvFile(envPath, { TELEGRAM_BOT_TOKEN: token }, { force: ["TELEGRAM_BOT_TOKEN"] });
    }

    success("Telegram channel configured");
    hint("Manasvi uses polling mode — no webhook URL needed");
    hint("Check status: pnpm manasvi channels status");
  }

  if (channelName === "slack") {
    info("You need a Slack app with Events API enabled.");
    info("Create one at: https://api.slack.com/apps");
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
    hint("Restart services to apply: pnpm manasvi restart");
  }

  console.log();
}

export async function runChannelsStatus(): Promise<void> {
  banner("channels status");

  const config = await loadConfig();
  if (!config?.initialized) { warn("Run `pnpm manasvi init` first"); return; }

  const envPath = envFilePath(config.projectPath);
  const env = await readEnvFile(envPath);
  const ingressRunning = await isPortInUse(config.services.ingressPort);

  section("Channel Status");

  // Telegram
  const telegramEnabled = config.channels.telegram?.enabled ?? false;
  const hasTelegramToken = !!(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_BOT_TOKEN !== "replace-me");

  table([
    {
      label: "Telegram enabled",
      value: telegramEnabled ? "yes" : "no",
      status: telegramEnabled ? "ok" : "dim"
    },
    {
      label: "Bot token set",
      value: hasTelegramToken ? "yes" : "no",
      status: hasTelegramToken ? "ok" : (telegramEnabled ? "error" : "dim")
    },
    {
      label: "Ingress service",
      value: ingressRunning ? "running" : "stopped",
      status: ingressRunning ? "ok" : "warn"
    }
  ]);

  if (telegramEnabled && hasTelegramToken && ingressRunning) {
    console.log();
    success("Telegram is ready to receive messages");
    hint("The ingress service polls Telegram automatically");
  } else if (telegramEnabled && !hasTelegramToken) {
    console.log();
    warn("Telegram is enabled but no bot token is set");
    hint("Fix: pnpm manasvi channels add telegram");
  } else if (!telegramEnabled) {
    console.log();
    info("Telegram not configured. Add with: pnpm manasvi channels add telegram");
  }

  console.log();
}

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
    config.channels.telegram = { enabled: false };
  } else if (channelName === "slack") {
    config.channels.slack = { enabled: false };
  }

  await saveConfig(config);
  success(`${channelName} channel disabled`);
  hint("Restart services to apply: pnpm manasvi restart");
  console.log();
}

export async function runChannelsLogs(serviceName?: string): Promise<void> {
  const target = serviceName ?? "ingress-service";
  const tail = await tailServiceLog(target);
  console.log(style.dim(`\n── ${target} logs (last 30 lines) ──\n`));
  console.log(tail);
  console.log();
}
