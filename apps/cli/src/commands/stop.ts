/**
 * manasvi stop
 * Gracefully stops all running Manasvi services.
 */

import { banner, section, success, info, hint } from "../lib/ui.js";
import { style } from "../lib/ui.js";
import { stopAllServices } from "../lib/services.js";

export async function runStop(): Promise<void> {
  banner("stop");
  section("Stopping services");

  await stopAllServices((service, status) => {
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
    if (status === "stopped") {
      console.log(`  ${style.green("✓")} ${label}`);
    } else if (status === "notRunning") {
      console.log(`  ${style.dim("·")} ${label.padEnd(20)} ${style.dim("not running")}`);
    }
  });

  console.log();
  success("All services stopped");
  hint("Run `pnpm manasvi start` to start again");
}
