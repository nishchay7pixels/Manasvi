import { CONTRACT_SCHEMA_VERSION } from "@manasvi/contracts";
import { respondJson, startHttpService } from "@manasvi/service-runtime";

import { loadMemoryServiceConfig } from "./config.js";

async function main(): Promise<void> {
  const config = await loadMemoryServiceConfig();
  await startHttpService({
    config,
    serviceName: "memory-service",
    serviceVersion: config.serviceVersion,
    readinessChecks: [{ name: "memory_runtime_initialized", check: async () => ({ ok: true }) }],
    handleRequest: async ({ req, res, trace }) => {
      if (req.method === "GET" && req.url === "/") {
        respondJson(res, 200, {
          schemaVersion: CONTRACT_SCHEMA_VERSION,
          service: config.serviceName,
          plane: "memory",
          trace
        });
        return true;
      }
      if (req.method === "GET" && req.url === "/memory/classes") {
        respondJson(res, 200, {
          schemaVersion: CONTRACT_SCHEMA_VERSION,
          classes: [
            "SESSION_EPHEMERAL",
            "USER_DURABLE",
            "ORG_SHARED_TRUSTED",
            "RETRIEVAL_UNTRUSTED",
            "ACTION_HISTORY_AUDIT_REF"
          ]
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
      service: "memory-service",
      message: "Service bootstrap failed",
      error: error instanceof Error ? error.message : "unknown"
    })
  );
  process.exit(1);
});

