/**
 * manasvi config <show|validate|path|edit>
 */

import { execSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { banner, section, info, success, warn, hint, table, style } from "../lib/ui.js";
import { loadConfig, configFilePath, cliHomePath } from "../lib/config.js";
import { fileExists, envFilePath, readEnvFile } from "../lib/env.js";

export async function runConfigShow(): Promise<void> {
  banner("config");

  const config = await loadConfig();
  if (!config) {
    warn("No config found. Run: pnpm manasvi init");
    return;
  }

  section("CLI Config");
  table([
    { label: "Profile", value: config.profile },
    { label: "Project", value: config.projectPath },
    { label: "Initialized", value: config.initialized ? "yes" : "no", status: config.initialized ? "ok" : "error" },
    { label: "Onboarded", value: config.onboarded ? "yes" : "no", status: config.onboarded ? "ok" : "warn" }
  ]);

  section("Model");
  table([
    { label: "Provider", value: config.model.provider },
    { label: "Ollama URL", value: config.model.ollamaBaseUrl },
    { label: "Ollama model", value: config.model.ollamaModel },
    { label: "OpenAI model", value: config.model.openaiModel }
  ]);

  section("Channels");
  const telegramStatus = config.channels.telegram?.enabled ? "enabled" : "disabled";
  const slackStatus = config.channels.slack?.enabled ? "enabled" : "disabled";
  table([
    { label: "Telegram", value: telegramStatus, status: config.channels.telegram?.enabled ? "ok" : "dim" },
    { label: "Slack", value: slackStatus, status: config.channels.slack?.enabled ? "ok" : "dim" }
  ]);

  section("Service Ports");
  const s = config.services;
  table([
    { label: "API Gateway", value: String(s.gatewayPort) },
    { label: "Ingress", value: String(s.ingressPort) },
    { label: "Orchestrator", value: String(s.orchestratorPort) },
    { label: "Policy", value: String(s.policyPort) },
    { label: "Execution Manager", value: String(s.executionPort) },
    { label: "Memory", value: String(s.memoryPort) },
    { label: "Node Manager", value: String(s.nodeManagerPort) },
    { label: "Audit", value: String(s.auditPort) },
    { label: "Approval", value: String(s.approvalPort) }
  ]);

  section("Files");
  hint(`Config: ${configFilePath()}`);
  hint(`Env:    ${envFilePath(config.projectPath)}`);
  console.log();
}

export async function runConfigPath(): Promise<void> {
  console.log(configFilePath());
}

export async function runConfigValidate(): Promise<void> {
  banner("config validate");

  const config = await loadConfig();
  if (!config) {
    warn("No config found. Run: pnpm manasvi init");
    process.exit(1);
  }

  let ok = true;

  section("Config file");
  success("Config file is valid JSON");

  section("Environment");
  const envPath = envFilePath(config.projectPath);
  const envExists = await fileExists(envPath);

  if (!envExists) {
    warn(".env.local not found at " + envPath);
    hint("Run: pnpm manasvi init");
    ok = false;
  } else {
    success(".env.local exists");
    const env = await readEnvFile(envPath);

    const required = [
      "INTERNAL_AUTH_KEY_ID",
      "INTERNAL_AUTH_SIGNING_SECRET",
      "APPROVAL_SIGNING_KEYS",
      "APPROVAL_VERIFICATION_KEYS",
      "EVENT_SIGNING_KEYS"
    ];

    for (const key of required) {
      if (!env[key] || env[key] === "replace-me") {
        warn(`${key} is not set`);
        ok = false;
      } else {
        success(`${key} is set`);
      }
    }
  }

  console.log();
  if (ok) {
    success("Configuration is valid");
  } else {
    warn("Configuration has issues — run `pnpm manasvi doctor` for more detail");
    process.exit(1);
  }
}

export async function runConfigEdit(): Promise<void> {
  const path = configFilePath();
  const editor = process.env.EDITOR ?? process.env.VISUAL ?? "nano";
  info(`Opening ${path} in ${editor}`);
  try {
    execSync(`${editor} "${path}"`, { stdio: "inherit" });
  } catch {
    warn("Editor exited with error. Config may not have been saved.");
    hint(`Edit manually: ${path}`);
  }
}
