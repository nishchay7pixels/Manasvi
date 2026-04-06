import { CONTRACT_SCHEMA_VERSION } from "@manasvi/contracts";
import { InternalTokenService, PrincipalResolver } from "@manasvi/auth";
import {
  policyEvaluationRequestSchema,
  policyEvaluationResponseSchema
} from "@manasvi/contracts";
import { readJsonBody, respondJson, startHttpService } from "@manasvi/service-runtime";

import { loadPolicyServiceConfig } from "./config.js";
import { evaluatePolicy } from "./policy-engine.js";
import { loadPolicySetFromFile } from "./policy-loader.js";

async function main(): Promise<void> {
  const config = await loadPolicyServiceConfig();
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
  const loadedPolicy = await loadPolicySetFromFile({
    filePath: config.policySetPath,
    loadedByService: config.serviceName
  });
  const decisionAuditBuffer: unknown[] = [];

  await startHttpService({
    config,
    serviceName: "policy-service",
    serviceVersion: config.serviceVersion,
    readinessChecks: [
      { name: "policy_runtime_initialized", check: async () => ({ ok: true }) },
      { name: "policy_set_loaded", check: async () => ({ ok: true, detail: loadedPolicy.policySet.policySetVersion }) }
    ],
    handleRequest: async ({ req, res, trace, logger }) => {
      if (req.method === "GET" && req.url === "/") {
        respondJson(res, 200, {
          schemaVersion: CONTRACT_SCHEMA_VERSION,
          service: config.serviceName,
          plane: "policy",
          trace
        });
        return true;
      }
      if (req.method === "GET" && req.url === "/policy/metadata") {
        respondJson(res, 200, {
          schemaVersion: CONTRACT_SCHEMA_VERSION,
          policySetVersion: loadedPolicy.policySet.policySetVersion,
          policySourceRef: loadedPolicy.policySet.sourceRef,
          policyDigest: loadedPolicy.digest,
          loadAuditRecord: loadedPolicy.loadAuditRecord
        });
        return true;
      }
      if (req.method === "GET" && req.url === "/policy/audit/decisions") {
        respondJson(res, 200, {
          schemaVersion: CONTRACT_SCHEMA_VERSION,
          decisions: decisionAuditBuffer
        });
        return true;
      }
      if (req.method === "POST" && req.url === "/policy/evaluate") {
        const principal = principalResolver.resolveFromHttpHeaders(req.headers, {
          requireAuthentication: true,
          allowActorOverride: false
        });
        if (!principal.ok) {
          respondJson(res, principal.statusCode ?? 401, {
            schemaVersion: CONTRACT_SCHEMA_VERSION,
            error: principal.errorCode
          });
          return true;
        }
        const raw = await readJsonBody(req);
        const request = policyEvaluationRequestSchema.parse(raw);
        const result = evaluatePolicy(loadedPolicy.policySet, request, {
          defaultDecisionTtlSeconds: config.defaultDecisionTtlSeconds
        });
        const response = policyEvaluationResponseSchema.parse(result.response);
        decisionAuditBuffer.unshift(result.auditRecord);
        if (decisionAuditBuffer.length > config.decisionAuditBufferSize) {
          decisionAuditBuffer.pop();
        }
        logger.info("Policy decision emitted", {
          decisionId: response.decisionId,
          decision: response.decision,
          reasonCodes: response.reasonCodes,
          matchedPolicyId: response.matchedPolicyId,
          matchedRuleId: response.matchedRuleId,
          auditRecordId: response.auditRecordId,
          callerPrincipalId: request.principalContext.caller.principalId,
          actorPrincipalId: request.principalContext.actor.principalId,
          actionClass: request.action.actionClass,
          resourceClass: request.resource.resourceClass,
          resourceId: request.resource.resourceId,
          traceId: trace.traceId,
          correlationId: trace.correlationId
        });
        respondJson(res, 200, response);
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
