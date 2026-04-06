import { CONTRACT_SCHEMA_VERSION } from "@manasvi/contracts";
import {
  InternalTokenService,
  PrincipalResolver,
  buildServicePrincipalReference
} from "@manasvi/auth";
import { HttpPolicyClient } from "@manasvi/policy-sdk";
import { respondJson, startHttpService } from "@manasvi/service-runtime";
import { readJsonBody } from "@manasvi/service-runtime";
import { z } from "zod";

import { loadExecutionManagerConfig } from "./config.js";
import { queryPolicyForExecution } from "./policy-integration.js";

async function main(): Promise<void> {
  const config = await loadExecutionManagerConfig();
  const firstKeyId = Object.keys(config.internalAuthVerificationKeys)[0];
  if (!firstKeyId) {
    throw new Error("internalAuthVerificationKeys must include at least one key");
  }
  if (!config.internalAuthVerificationKeys[firstKeyId]) {
    throw new Error(`Missing secret for key id ${firstKeyId}`);
  }
  const tokenService = new InternalTokenService(
    {
      issuer: config.internalAuthIssuer,
      audience: config.internalAuthAudience,
      keyId: config.internalAuthKeyId,
      secret: config.internalAuthSigningSecret,
      ttlSeconds: 120
    },
    {
      issuer: config.internalAuthIssuer,
      audience: config.internalAuthAudience,
      secretsByKeyId: config.internalAuthVerificationKeys
    }
  );
  const principalResolver = new PrincipalResolver(tokenService);
  const policyClient = new HttpPolicyClient({
    baseUrl: config.policyServiceBaseUrl,
    getAuthToken: () =>
      tokenService.issueToken({
        caller: buildServicePrincipalReference(config.serviceName),
        scopes: ["policy.evaluate", "service:execution-manager"]
      })
  });

  const dispatchRequestSchema = z.object({
    tenantId: z.string().min(1),
    workspaceId: z.string().min(1),
    executionNodeId: z.string().min(1),
    actionId: z.string().min(1).default("execution.dispatch"),
    requestedCapabilities: z.array(z.string().min(1)).default(["node.execute"]),
    riskFlags: z.array(z.string().min(1)).default([]),
    skipApprovalRequested: z.boolean().default(false)
  });

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
        const principal = principalResolver.resolveFromHttpHeaders(req.headers, {
          requireAuthentication: true,
          allowActorOverride: true
        });
        if (!principal.ok || !principal.context) {
          respondJson(res, principal.statusCode ?? 401, {
            schemaVersion: CONTRACT_SCHEMA_VERSION,
            accepted: false,
            errorCode: principal.errorCode
          });
          return true;
        }
        const incoming = dispatchRequestSchema.parse(await readJsonBody(req));
        const decision = await queryPolicyForExecution(policyClient, {
          principalContext: principal.context,
          actionClass: "execute",
          actionId: incoming.actionId,
          resource: {
            resourceClass: "execution-node",
            resourceId: incoming.executionNodeId,
            tenantId: incoming.tenantId,
            workspaceId: incoming.workspaceId,
            attributes: {}
          },
          requestedCapabilities: incoming.requestedCapabilities,
          tenantId: incoming.tenantId,
          workspaceId: incoming.workspaceId,
          trace,
          skipApprovalRequested: incoming.skipApprovalRequested,
          riskFlags: incoming.riskFlags
        });
        logger.info("Policy evaluated execution dispatch", {
          decision: decision.decision,
          reasonCodes: decision.reasonCodes,
          auditRecordId: decision.auditRecordId
        });
        if (decision.decision === "DENY") {
          respondJson(res, 403, {
            schemaVersion: CONTRACT_SCHEMA_VERSION,
            accepted: false,
            decision
          });
          return true;
        }
        respondJson(res, 202, {
          schemaVersion: CONTRACT_SCHEMA_VERSION,
          accepted: true,
          decision
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
