import { CONTRACT_SCHEMA_VERSION } from "@manasvi/contracts";
import { respondJson, startHttpService } from "@manasvi/service-runtime";

import { loadAuditServiceConfig } from "./config.js";

async function main(): Promise<void> {
  const config = await loadAuditServiceConfig();
  await startHttpService({
    config,
    serviceName: "audit-service",
    serviceVersion: config.serviceVersion,
    readinessChecks: [{ name: "audit_writer_initialized", check: async () => ({ ok: true }) }],
    handleRequest: async ({ req, res, trace, logger }) => {
      if (req.method === "GET" && req.url === "/") {
        respondJson(res, 200, {
          schemaVersion: CONTRACT_SCHEMA_VERSION,
          service: config.serviceName,
          plane: "observability",
          trace
        });
        return true;
      }
      if (req.method === "POST" && req.url === "/audit/events") {
        logger.info("Audit event ingest placeholder accepted");
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
      service: "audit-service",
      message: "Service bootstrap failed",
      error: error instanceof Error ? error.message : "unknown"
    })
  );
  process.exit(1);
});

