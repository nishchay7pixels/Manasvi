/**
 * Service lifecycle management — spawn, track, and stop Manasvi services.
 * Each service runs as an independent child process (as designed).
 */

import { spawn } from "node:child_process";
import { mkdir, open } from "node:fs/promises";
import { join } from "node:path";
import { logsDir, loadPids, savePids, type ManasviConfig, type PidMap } from "./config.js";
import { waitForService, getServiceSpecs, type ServiceSpec } from "./health.js";
import { fileExists, readEnvFile, envFilePath } from "./env.js";

// Startup order — respects service dependencies
const STARTUP_ORDER = [
  "policy-service",
  "approval-service",
  "memory-service",
  "audit-service",
  "execution-manager",
  "node-manager",
  "orchestrator-service",
  "ingress-service",
  "api-gateway"
];

export interface StartResult {
  service: string;
  started: boolean;
  pid?: number;
  alreadyRunning?: boolean;
  error?: string;
}

/**
 * Spawn a single service as a detached background process.
 * Logs go to ~/.manasvi/logs/<service>.log
 */
async function spawnService(
  serviceName: string,
  projectRoot: string,
  env: NodeJS.ProcessEnv
): Promise<{ pid: number | undefined; error?: string }> {
  const logDir = logsDir();
  await mkdir(logDir, { recursive: true });
  const logPath = join(logDir, `${serviceName}.log`);

  try {
    const logFile = await open(logPath, "a");
    const proc = spawn(
      "node_modules/.bin/tsx",
      ["watch", `apps/${serviceName}/src/index.ts`],
      {
        cwd: projectRoot,
        env: { ...process.env, ...env, FORCE_COLOR: "0" },
        detached: true,
        stdio: ["ignore", logFile.fd, logFile.fd]
      }
    );

    await logFile.close();

    proc.unref();
    return { pid: proc.pid };
  } catch (err) {
    return { pid: undefined, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Start all services in dependency order.
 */
export async function startAllServices(
  config: ManasviConfig,
  onProgress: (service: string, status: "starting" | "ready" | "failed" | "skipped") => void
): Promise<StartResult[]> {
  const projectRoot = config.projectPath;
  const envPath = envFilePath(projectRoot);
  const envVars = await readEnvFile(envPath);

  const specs = getServiceSpecs(config);
  const specMap = new Map(specs.map((s) => [s.name, s]));
  const existingPids = await loadPids();
  const newPids: PidMap = {};
  const results: StartResult[] = [];

  for (const serviceName of STARTUP_ORDER) {
    const spec = specMap.get(serviceName);
    if (!spec) continue;

    onProgress(serviceName, "starting");

    // Check if already running and healthy on its expected port.
    const existingPid = existingPids[serviceName];
    if (existingPid) {
      try {
        process.kill(existingPid, 0); // 0 = existence check

        const healthyExisting = await waitForService(spec.port, 1200, 200);
        if (healthyExisting) {
          newPids[serviceName] = existingPid;
          results.push({ service: serviceName, started: false, alreadyRunning: true, pid: existingPid });
          onProgress(serviceName, "skipped");
          continue;
        }

        // Stale process: alive but not serving health, so recycle it.
        try {
          process.kill(existingPid, "SIGTERM");
        } catch {
          // no-op: process may already be exiting
        }
        await waitForDeath(existingPid, 1500);
      } catch {
        // Process gone — proceed to spawn
      }
    }

    const { pid, error } = await spawnService(serviceName, projectRoot, envVars);

    if (!pid || error) {
      results.push({ service: serviceName, started: false, error: error ?? "failed to spawn" });
      onProgress(serviceName, "failed");
      continue;
    }

    newPids[serviceName] = pid;

    // Wait for health endpoint
    const healthy = await waitForService(spec.port, 15000, 400);
    if (healthy) {
      results.push({ service: serviceName, started: true, pid });
      onProgress(serviceName, "ready");
    } else {
      results.push({ service: serviceName, started: true, pid, error: "health check timed out" });
      onProgress(serviceName, "failed");
    }
  }

  await savePids(newPids);
  return results;
}

export type StopStatus = "stopping" | "stopped" | "forceKilled" | "notRunning" | "timeout";

export interface StopResult {
  service: string;
  status: StopStatus;
  pid: number;
}

/**
 * Poll until a process is gone or the timeout expires.
 * Returns true if the process is gone.
 */
async function waitForDeath(pid: number, timeoutMs: number, intervalMs = 100): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0); // throws if gone
    } catch {
      return true; // process is dead
    }
    await new Promise<void>((r) => setTimeout(r, intervalMs));
  }
  return false;
}

/**
 * Stop all tracked services.
 *
 * - Sends SIGTERM and waits up to 5s for each process to exit.
 * - With force=true, sends SIGKILL to any process still alive after the grace period.
 * - Without force, reports "timeout" for stubborn processes (leaves them running).
 */
export async function stopAllServices(
  onProgress: (service: string, status: StopStatus, pid: number) => void,
  opts: { force?: boolean; gracePeriodMs?: number } = {}
): Promise<StopResult[]> {
  const { force = false, gracePeriodMs = 5000 } = opts;
  const pids = await loadPids();
  const results: StopResult[] = [];
  const survivingPids: PidMap = {};

  for (const [name, pid] of Object.entries(pids)) {
    // Check whether the process is actually alive first
    try {
      process.kill(pid, 0);
    } catch {
      onProgress(name, "notRunning", pid);
      results.push({ service: name, status: "notRunning", pid });
      continue;
    }

    onProgress(name, "stopping", pid);

    // Send SIGTERM
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // Already gone between the check and kill
      onProgress(name, "stopped", pid);
      results.push({ service: name, status: "stopped", pid });
      continue;
    }

    // Wait for graceful exit
    const died = await waitForDeath(pid, gracePeriodMs);

    if (died) {
      onProgress(name, "stopped", pid);
      results.push({ service: name, status: "stopped", pid });
      continue;
    }

    // Still alive after grace period
    if (force) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // Already gone
      }
      // Give SIGKILL a moment to land
      await waitForDeath(pid, 1000);
      onProgress(name, "forceKilled", pid);
      results.push({ service: name, status: "forceKilled", pid });
    } else {
      // Leave it running — report timeout
      survivingPids[name] = pid;
      onProgress(name, "timeout", pid);
      results.push({ service: name, status: "timeout", pid });
    }
  }

  await savePids(survivingPids);
  return results;
}

/**
 * Is a specific service process alive?
 */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the log file path for a service.
 */
export function serviceLogPath(serviceName: string): string {
  return join(logsDir(), `${serviceName}.log`);
}

/**
 * Tail the last N lines of a service log.
 */
export async function tailServiceLog(serviceName: string, lines = 30): Promise<string> {
  const { readFile } = await import("node:fs/promises");
  const path = serviceLogPath(serviceName);
  if (!(await fileExists(path))) return "(no log file found)";
  try {
    const content = await readFile(path, "utf8");
    const all = content.split("\n");
    return all.slice(-lines).join("\n");
  } catch {
    return "(error reading log)";
  }
}
