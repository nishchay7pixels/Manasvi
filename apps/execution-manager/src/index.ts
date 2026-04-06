import { CONTRACT_SCHEMA_VERSION } from "@manasvi/contracts";
import { respondJson, startHttpService } from "@manasvi/service-runtime";

import { loadExecutionManagerConfig } from "./config.js";

async function main(): Promise<void> {
  const config = await loadExecutionManagerConfig();
  await startHttpService({
    config,
    serviceName: "execution-manager",
    serviceVersion: config.serviceVersion,
    readinessChecks: [{ name: "sandbox_runtime_initialized", check: async () => ({ ok: true }) }],
    handleRequest: async ({ req, res, trace, logger }) => {
      if (req.method === "GET" && req.url === "/") {
        respondJson(res, 200, {
          schemaVersion: CONTRACT_SCHEMA_VERSION,
          service: config.serviceName,
          plane: "execution",
          trace
        });
        return true;
      }
      if (req.method === "POST" && req.url === "/execution/dispatch") {
        logger.info("Execution dispatch placeholder accepted");
        respondJson(res, 202, {
          schemaVersion: CONTRACT_SCHEMA_VERSION,
          accepted: true
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
      service: "execution-manager",
      message: "Service bootstrap failed",
      error: error instanceof Error ? error.message : "unknown"
    })
  );
  process.exit(1);
});

