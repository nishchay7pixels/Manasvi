/**
 * manasvi start
 * Starts all Manasvi services in dependency order.
 */

import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { banner, section, success, warn, error, info, hint, step, nextSteps, checkRow } from "../lib/ui.js";
import { requireConfig } from "../lib/config.js";
import { startAllServices } from "../lib/services.js";
import { checkAllServices } from "../lib/health.js";
import { style } from "../lib/ui.js";
import { envFilePath, readEnvFile } from "../lib/env.js";

export async function runStart(args: { services?: string[] } = {}): Promise<void> {
  banner("start");

  const config = await requireConfig();
  const env = await readEnvFile(envFilePath(config.projectPath));
  const workspaceRoot = resolve(env.MANASVI_WORKSPACE_ROOT ?? config.workspacePath ?? resolve(config.projectPath, "workspace"));
  await mkdir(workspaceRoot, { recursive: true });

  section("Starting services");
  info(`Workspace root: ${workspaceRoot}`);
  info("Services will start in dependency order. This may take a few seconds.");
  console.log();

  const results = await startAllServices(config, (service, status) => {
    const labels: Record<string, string> = {
      "api-gateway": "API Gateway",
      "ingress-service": "Ingress",
      "orchestrator-service": "Orchestrator",
      "policy-service": "Policy",
      "execution-manager": "Execution Manager",
      "memory-service": "Memory",
      "node-manager": "Node Manager",
      "audit-service": "Audit",
      "approval-service": "Approval"
    };
    const label = labels[service] ?? service;

    if (status === "starting") {
      process.stdout.write(`  ${style.dim("·")} ${label.padEnd(20)} ${style.dim("starting…")}\r`);
    } else if (status === "ready") {
      process.stdout.write("\r\x1b[K");
      console.log(`  ${style.green("✓")} ${label}`);
    } else if (status === "skipped") {
      process.stdout.write("\r\x1b[K");
      console.log(`  ${style.dim("·")} ${label.padEnd(20)} ${style.dim("already running")}`);
    } else if (status === "failed") {
      process.stdout.write("\r\x1b[K");
      console.log(`  ${style.red("✗")} ${label.padEnd(20)} ${style.yellow("failed to start")}`);
    }
  });

  console.log();

  const started = results.filter((r) => r.started && !r.error);
  const alreadyRunning = results.filter((r) => r.alreadyRunning);
  const failed = results.filter((r) => r.error);

  section("Summary");

  if (started.length > 0) {
    success(`${started.length} service(s) started`);
  }
  if (alreadyRunning.length > 0) {
    info(`${alreadyRunning.length} service(s) were already running`);
  }
  if (failed.length > 0) {
    warn(`${failed.length} service(s) failed to start`);
    for (const f of failed) {
      hint(`  ${f.service}: ${f.error ?? "unknown error"}`);
    }
    hint("Run `pnpm manasvi doctor` to diagnose issues");
    hint("Check logs: pnpm manasvi channels logs <service>");
  }

  if (failed.length === 0) {
    const s = config.services;
    const hasTelegram = config.channels.telegram?.enabled;
    const hasSlack = config.channels.slack?.enabled;

    console.log();
    info(`API Gateway:  http://localhost:${s.gatewayPort}`);
    if (config.ui.docsEnabled) {
      info(`Docs UI:      http://localhost:${config.ui.docsPort}`);
    }

    const steps: string[] = [];

    // First thing a new user should do
    steps.push("`pnpm cli` — send your first message in the terminal");

    if (hasTelegram) {
      steps.push("Open Telegram and message your bot to test the channel");
    } else if (hasSlack) {
      steps.push("Message your Slack bot to test the channel");
    } else {
      steps.push("`pnpm manasvi channels add telegram` — connect Telegram for mobile chat");
    }

    steps.push("`pnpm manasvi status` — verify all services are healthy");
    steps.push("`pnpm manasvi stop` — stop all services when done");

    nextSteps(steps);
  } else {
    process.exit(1);
  }
}
