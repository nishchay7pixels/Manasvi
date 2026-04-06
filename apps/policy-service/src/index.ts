import { CONTRACT_SCHEMA_VERSION } from "@manasvi/contracts";
import { respondJson, startHttpService } from "@manasvi/service-runtime";

import { loadPolicyServiceConfig } from "./config.js";

async function main(): Promise<void> {
  const config = await loadPolicyServiceConfig();
  await startHttpService({
    config,
    serviceName: "policy-service",
    serviceVersion: config.serviceVersion,
    readinessChecks: [{ name: "policy_runtime_initialized", check: async () => ({ ok: true }) }],
    handleRequest: async ({ req, res, trace }) => {
      if (req.method === "GET" && req.url === "/") {
        respondJson(res, 200, {
          schemaVersion: CONTRACT_SCHEMA_VERSION,
          service: config.serviceName,
          plane: "policy",
          trace
        });
        return true;
      }
      if (req.method === "POST" && req.url === "/policy/evaluate") {
        respondJson(res, 200, {
          schemaVersion: CONTRACT_SCHEMA_VERSION,
          decision: "DENY",
          reasonCodes: ["POLICY_ENGINE_PLACEHOLDER"]
        });
        return true;
      }
      return false;
    }
  });
}

void main().catch((error) => {
  console.error(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level: "error",
      service: "policy-service",
      message: "Service bootstrap failed",
      error: error instanceof Error ? error.message : "unknown"
    })
  );
  process.exit(1);
});

