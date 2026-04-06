import { CONTRACT_SCHEMA_VERSION } from "@manasvi/contracts";
import {
  JsonFilePrincipalRegistry,
  InternalTokenService,
  PrincipalResolver,
  bootstrapServicePrincipal,
  buildExecutionNodePrincipalReference
} from "@manasvi/auth";
import { readJsonBody, respondJson, startHttpService } from "@manasvi/service-runtime";
import { z } from "zod";

import { loadNodeManagerConfig } from "./config.js";

async function main(): Promise<void> {
  const config = await loadNodeManagerConfig();
  const registry = new JsonFilePrincipalRegistry(config.principalRegistryPath);
  const firstKeyId = Object.keys(config.internalAuthVerificationKeys)[0];
  if (!firstKeyId) {
    throw new Error("internalAuthVerificationKeys must include at least one key");
  }
  const firstKeySecret = config.internalAuthVerificationKeys[firstKeyId];
  if (!firstKeySecret) {
    throw new Error(`Missing secret for key id ${firstKeyId}`);
  }
  const tokenService = new InternalTokenService(
    {
      issuer: config.internalAuthIssuer,
      audience: config.internalAuthAudience,
      keyId: firstKeyId,
      secret: firstKeySecret,
      ttlSeconds: 120
    },
    {
      issuer: config.internalAuthIssuer,
      audience: config.internalAuthAudience,
      secretsByKeyId: config.internalAuthVerificationKeys
    }
  );
  const principalResolver = new PrincipalResolver(tokenService);
  const registerNodeSchema = z.object({
    nodeId: z.string().min(1),
    mode: z.enum(["local", "remote"]),
    runtimeClass: z.string().min(1).default("sandboxed"),
    sandboxProfile: z.string().min(1).default("default"),
    tenantId: z.string().min(1).optional(),
    workspaceId: z.string().min(1).optional()
  });
  await bootstrapServicePrincipal(registry, {
    serviceName: config.serviceName,
    environment: config.environment,
    instanceId: `${config.serviceName}-${config.host}-${config.port}`
  });

  await startHttpService({
    config,
    serviceName: "node-manager",
    serviceVersion: config.serviceVersion,
    readinessChecks: [{ name: "node_registry_initialized", check: async () => ({ ok: true }) }],
    handleRequest: async ({ req, res, trace, logger }) => {
      if (req.method === "GET" && req.url === "/") {
        respondJson(res, 200, {
          schemaVersion: CONTRACT_SCHEMA_VERSION,
          service: config.serviceName,
          plane: "node",
          trace
        });
        return true;
      }
      if (req.method === "POST" && req.url === "/nodes/register") {
        const principal = principalResolver.resolveFromHttpHeaders(req.headers, {
          requireAuthentication: true,
          allowActorOverride: false
        });
        if (!principal.ok) {
          respondJson(res, principal.statusCode ?? 401, {
            schemaVersion: CONTRACT_SCHEMA_VERSION,
            accepted: false,
            errorCode: principal.errorCode
          });
          return true;
        }
        const payload = registerNodeSchema.parse(await readJsonBody(req));
        const nodePrincipal = buildExecutionNodePrincipalReference(payload.nodeId);
        const registered = await registry.registerPrincipal({
          principalId: nodePrincipal.principalId,
          principalType: nodePrincipal.principalType,
          displayName: payload.nodeId,
          ...(payload.tenantId ? { tenantId: payload.tenantId } : {}),
          ...(payload.workspaceId ? { workspaceId: payload.workspaceId } : {}),
          provenance: {
            source: "node_registration",
            sourceRef: principal.context?.caller.principalId
          },
          executionNode: {
            nodeId: payload.nodeId,
            mode: payload.mode,
            status: "registered",
            runtimeClass: payload.runtimeClass,
            sandboxProfile: payload.sandboxProfile,
            registeredAt: new Date().toISOString()
          }
        });
        logger.info("Node principal registered", {
          callerPrincipalId: principal.context?.caller.principalId,
          nodePrincipalId: registered.principalId
        });
        respondJson(res, 201, {
          schemaVersion: CONTRACT_SCHEMA_VERSION,
          accepted: true,
          nodePrincipalId: registered.principalId
        });
        return true;
      }
      if (req.method === "GET" && req.url === "/nodes") {
        const principals = await registry.listPrincipals({ principalType: "execution_node" });
        respondJson(res, 200, {
          schemaVersion: CONTRACT_SCHEMA_VERSION,
          nodes: principals.map((principal) => ({
            principalId: principal.principalId,
            status: principal.status,
            executionNode: principal.executionNode
          }))
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
      service: "node-manager",
      message: "Service bootstrap failed",
      error: error instanceof Error ? error.message : "unknown"
    })
  );
  process.exit(1);
});
