/**
 * manasvi stop
 *
 * Stops all running Manasvi services.
 *
 * Sends SIGTERM and waits up to 5 seconds for each service to exit.
 * With --force, sends SIGKILL to any service that hasn't exited by then.
 */

import { banner, section, success, warn, error, info, hint } from "../lib/ui.js";
import { style } from "../lib/ui.js";
import { stopAllServices, type StopStatus } from "../lib/services.js";

const SERVICE_LABELS: Record<string, string> = {
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

export async function runStop(opts: { force?: boolean } = {}): Promise<void> {
  banner("stop");

  if (opts.force) {
    info("Force mode: services that do not stop gracefully will be killed.");
  }

  section("Stopping services");

  const results = await stopAllServices(
    (service, status, pid) => {
      const label = (SERVICE_LABELS[service] ?? service).padEnd(20);

      if (status === "stopping") {
        process.stdout.write(`  ${style.dim("·")} ${label} ${style.dim("stopping…")}\r`);
        return;
      }

      // Clear the "stopping…" line before printing the final status
      process.stdout.write("\r\x1b[K");

      if (status === "stopped") {
        console.log(`  ${style.green("✓")} ${label}`);
      } else if (status === "forceKilled") {
        console.log(`  ${style.yellow("✓")} ${label} ${style.yellow("force killed")}`);
      } else if (status === "notRunning") {
        console.log(`  ${style.dim("·")} ${label} ${style.dim("not running")}`);
      } else if (status === "timeout") {
        console.log(`  ${style.red("✗")} ${label} ${style.red("did not stop — run with --force to kill")}`);
      }
    },
    { force: opts.force }
  );

  console.log();

  const stopped = results.filter((r) => r.status === "stopped").length;
  const forceKilled = results.filter((r) => r.status === "forceKilled").length;
  const timedOut = results.filter((r) => r.status === "timeout");
  const notRunning = results.filter((r) => r.status === "notRunning").length;

  if (timedOut.length > 0) {
    warn(`${timedOut.length} service(s) did not stop within the grace period:`);
    for (const r of timedOut) {
      hint(`  ${SERVICE_LABELS[r.service] ?? r.service}  (pid ${r.pid})`);
    }
    console.log();
    error("Run `pnpm manasvi stop --force` to force kill remaining services.");
    process.exit(1);
  }

  if (stopped + forceKilled > 0) {
    if (forceKilled > 0) {
      success(`${stopped} service(s) stopped · ${forceKilled} force killed`);
    } else {
      success(`${stopped} service(s) stopped`);
    }
  } else if (notRunning === results.length) {
    info("No services were running.");
  } else {
    success("All services stopped");
  }

  hint("Run `pnpm manasvi start` to start again");
}
