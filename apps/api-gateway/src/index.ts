import { CONTRACT_SCHEMA_VERSION } from "@manasvi/contracts";
import { respondJson, startHttpService } from "@manasvi/service-runtime";

import { loadApiGatewayConfig } from "./config.js";

async function main(): Promise<void> {
  const config = await loadApiGatewayConfig();
  await startHttpService({
    config,
    serviceName: "api-gateway",
    serviceVersion: config.serviceVersion,
    readinessChecks: [{ name: "routing_table_initialized", check: async () => ({ ok: true }) }],
    handleRequest: async ({ req, res, trace }) => {
      if (req.method === "GET" && req.url === "/") {
        respondJson(res, 200, {
          schemaVersion: CONTRACT_SCHEMA_VERSION,
          service: config.serviceName,
          plane: "gateway",
          trace
        });
        return true;
      }
      if (req.method === "GET" && req.url === "/routes") {
        respondJson(res, 200, {
          schemaVersion: CONTRACT_SCHEMA_VERSION,
          routes: [
            { path: "/ingress/events", upstream: config.ingressBaseUrl },
            { path: "/orchestration/plan", upstream: config.orchestratorBaseUrl }
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
      service: "api-gateway",
      message: "Service bootstrap failed",
      error: error instanceof Error ? error.message : "unknown"
    })
  );
  process.exit(1);
});
