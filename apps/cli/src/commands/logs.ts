/**
 * manasvi logs [service] [--tail N] [--follow]
 * View and tail service log files from ~/.manasvi/logs/
 */

import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { banner, section, info, warn, hint, style } from "../lib/ui.js";
import { logsDir } from "../lib/config.js";
import { loadConfig } from "../lib/config.js";
import { fileExists } from "../lib/env.js";
import { getServiceSpecs } from "../lib/health.js";

const KNOWN_SERVICES = [
  "api-gateway",
  "ingress-service",
  "orchestrator-service",
  "policy-service",
  "execution-manager",
  "memory-service",
  "node-manager",
  "audit-service",
  "approval-service"
];

export interface LogsOptions {
  service?: string;
  tail?: number;
  follow?: boolean;
}

async function getLogPath(serviceName: string): Promise<string> {
  return join(logsDir(), `${serviceName}.log`);
}

async function tailLog(logPath: string, lines: number): Promise<string> {
  if (!(await fileExists(logPath))) return "(no log file found)";
  try {
    const content = await readFile(logPath, "utf8");
    const all = content.split("\n").filter((l) => l.length > 0);
    return all.slice(-lines).join("\n");
  } catch {
    return "(error reading log)";
  }
}

async function followLog(logPath: string, initialLines: number): Promise<void> {
  if (!(await fileExists(logPath))) {
    warn(`Log file not found: ${logPath}`);
    hint("Start services first: pnpm manasvi start");
    return;
  }

  // Print tail first
  const initial = await tailLog(logPath, initialLines);
  if (initial) console.log(initial);

  // Poll for new content
  let lastSize = 0;
  try {
    const s = await stat(logPath);
    lastSize = s.size;
  } catch {
    lastSize = 0;
  }

  info(`Following log: ${style.dim(logPath)}`);
  hint("Press Ctrl+C to stop.");
  console.log();

  const interval = setInterval(async () => {
    try {
      const s = await stat(logPath);
      if (s.size > lastSize) {
        const buf = await readFile(logPath, "utf8");
        const newContent = buf.slice(lastSize);
        process.stdout.write(newContent);
        lastSize = s.size;
      }
    } catch {
      // file may have rotated — reset
      lastSize = 0;
    }
  }, 500);

  process.on("SIGINT", () => {
    clearInterval(interval);
    console.log("\n");
    process.exit(0);
  });

  // Keep alive
  await new Promise<void>(() => {});
}

export async function runLogs(opts: LogsOptions = {}): Promise<void> {
  const { service, tail = 50, follow = false } = opts;

  const config = await loadConfig();

  if (!service) {
    // No service — show all available log files
    banner("logs");

    interface ServiceEntry { name: string; label: string; port: number; optional?: boolean }
  const specs: ServiceEntry[] = config
    ? getServiceSpecs(config)
    : KNOWN_SERVICES.map((n) => ({ name: n, label: n, port: 0, optional: false }));

    section("Available log files");

    const logDir = logsDir();
    let anyFound = false;

    for (const spec of specs) {
      const logPath = join(logDir, `${spec.name}.log`);
      const exists = await fileExists(logPath);
      if (exists) {
        try {
          const s = await stat(logPath);
          const size = (s.size / 1024).toFixed(1);
          console.log(`  ${style.green("●")} ${spec.label.padEnd(22)}  ${style.dim(`${size} KB`)}   ${style.dim(`pnpm manasvi logs ${spec.name}`)}`);
          anyFound = true;
        } catch {
          // skip
        }
      } else {
        console.log(`  ${style.dim("○")} ${spec.label.padEnd(22)}  ${style.dim("no log yet")}`);
      }
    }

    if (!anyFound) {
      console.log();
      warn("No log files found.");
      hint("Start services first: pnpm manasvi start");
    }

    console.log();
    hint("Usage: pnpm manasvi logs <service> [--tail N] [--follow]");
    console.log();
    return;
  }

  // Single service
  const logPath = await getLogPath(service);
  const exists = await fileExists(logPath);

  if (!exists) {
    warn(`No log file found for: ${service}`);
    hint(`Expected: ${logPath}`);
    hint("Start the service first: pnpm manasvi start " + service);

    // Suggest closest match
    const match = KNOWN_SERVICES.find((s) => s.includes(service) || service.includes(s.split("-")[0]!));
    if (match && match !== service) {
      hint(`Did you mean: ${style.cyan(match)}?`);
    }
    process.exit(1);
  }

  if (follow) {
    console.log(`${style.boldCyan("Manasvi")} ${style.dim(`logs: ${service}`)}\n`);
    await followLog(logPath, tail);
  } else {
    console.log(`${style.boldCyan("Manasvi")} ${style.dim(`logs: ${service} (last ${tail} lines)`)}\n`);
    const content = await tailLog(logPath, tail);
    console.log(content || style.dim("(empty log)"));
    console.log();
    hint(`Follow live: pnpm manasvi logs ${service} --follow`);
    console.log();
  }
}
