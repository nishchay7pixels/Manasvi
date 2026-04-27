import { readJsonBody, respondJson, startHttpService } from "@manasvi/service-runtime";
import {
  CONTRACT_SCHEMA_VERSION,
  memoryClassSchema,
  memoryContextCandidatesRequestSchema,
  memoryPromotionCandidateRequestSchema,
  memoryPromotionReviewSchema,
  memoryQueryRequestSchema,
  memoryWriteRequestSchema
} from "@manasvi/contracts";
import {
  InternalTokenService,
  PrincipalResolver,
  buildServicePrincipalReference
} from "@manasvi/auth";
import { HttpPolicyClient } from "@manasvi/policy-sdk";

import { loadMemoryServiceConfig } from "./config.js";
import { InMemoryTrustClassifiedMemoryPlane, MemoryPlaneError } from "./memory-plane.js";
import { queryPolicyForMemory } from "./policy-integration.js";

async function main(): Promise<void> {
  const config = await loadMemoryServiceConfig();
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
        scopes: ["policy.evaluate", "service:memory-service"]
      })
  });
  const memoryPlane = new InMemoryTrustClassifiedMemoryPlane({
    serviceName: config.serviceName,
    encryptionKey: config.memoryEncryptionKey,
    encryptionKeyRef: config.memoryEncryptionKeyRef,
    ttlByClass: {
      EPHEMERAL_SESSION: config.ephemeralTtlSeconds,
      USER_DURABLE: undefined,
      ORG_SHARED_TRUSTED: undefined,
      UNTRUSTED_EXTERNAL: config.untrustedTtlSeconds,
      AUDIT_ACTION_HISTORY: undefined
    }
  });
  let lastPruneAt = Date.now();

  await startHttpService({
    config,
    serviceName: "memory-service",
    serviceVersion: config.serviceVersion,
    readinessChecks: [{ name: "memory_runtime_initialized", check: async () => ({ ok: true }) }],
    handleRequest: async ({ req, res, trace, logger }) => {
      if (Date.now() - lastPruneAt > config.retentionPruneIntervalSeconds * 1000) {
        const prune = memoryPlane.pruneExpired();
        if (prune.deletedRecordIds.length > 0) {
          logger.info("Memory retention prune executed", {
            deletedCount: prune.deletedRecordIds.length
          });
        }
        lastPruneAt = Date.now();
      }
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
          classes: memoryClassSchema.options
        });
        return true;
      }

      // ── Admin list-all records (no auth — local dashboard use only) ──────
      if (req.method === "GET" && req.url?.startsWith("/admin/memory")) {
        const url = new URL(req.url, "http://localhost");
        const memoryClassParam = url.searchParams.get("memoryClass");
        const limit = parseInt(url.searchParams.get("limit") ?? "100", 10);
        const records = memoryPlane.adminListRecords({
          ...(memoryClassParam ? { memoryClass: memoryClassParam } : {}),
          limit: Math.min(limit, 500)
        });
        respondJson(res, 200, {
          schemaVersion: CONTRACT_SCHEMA_VERSION,
          records,
          count: records.length
        });
        return true;
      }
      // ─────────────────────────────────────────────────────────────────────

      if (req.method === "GET" && req.url?.startsWith("/memory/records/")) {
        const principal = principalResolver.resolveFromHttpHeaders(req.headers, {
          requireAuthentication: true,
          allowActorOverride: true
        });
        if (!principal.ok || !principal.context) {
          respondJson(res, principal.statusCode ?? 401, {
            schemaVersion: CONTRACT_SCHEMA_VERSION,
            errorCode: principal.errorCode
          });
          return true;
        }
        const recordId = decodeURIComponent(req.url.slice("/memory/records/".length));
        const record = memoryPlane.getRecord({
          recordId,
          principalContext: principal.context,
          trace
        });
        if (!record) {
          respondJson(res, 404, {
            schemaVersion: CONTRACT_SCHEMA_VERSION,
            error: "record not found"
          });
          return true;
        }
        const decision = await queryPolicyForMemory(policyClient, {
          principalContext: principal.context,
          actionClass: "read",
          actionId: "memory.record.read",
          namespace: record.namespace,
          tenantId: record.tenantId,
          workspaceId: record.workspaceId,
          requestedCapabilities: ["memory.read"],
          trace
        });
        if (decision.decision === "DENY") {
          respondJson(res, 403, {
            schemaVersion: CONTRACT_SCHEMA_VERSION,
            error: "policy denied"
          });
          return true;
        }
        respondJson(res, 200, {
          schemaVersion: CONTRACT_SCHEMA_VERSION,
          record
        });
        return true;
      }
      if (req.method === "POST" && req.url === "/memory/records") {
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
        const write = memoryWriteRequestSchema.parse(await readJsonBody(req));
        const decision = await queryPolicyForMemory(policyClient, {
          principalContext: principal.context,
          actionClass: "mutate-memory",
          actionId: "memory.record.write",
          namespace: write.namespace,
          tenantId: write.tenantId,
          workspaceId: write.workspaceId,
          requestedCapabilities: ["memory.write"],
          trace: write.trace,
          riskFlags: [write.memoryClass.toLowerCase()]
        });
        if (decision.decision === "DENY" || decision.decision === "REQUIRE_APPROVAL") {
          respondJson(res, 403, {
            schemaVersion: CONTRACT_SCHEMA_VERSION,
            accepted: false,
            decision
          });
          return true;
        }
        const record = memoryPlane.createRecord({
          write,
          principalContext: principal.context,
          policyDecisionId: decision.decisionId
        });
        respondJson(res, 201, {
          schemaVersion: CONTRACT_SCHEMA_VERSION,
          accepted: true,
          record
        });
        return true;
      }
      if (req.method === "POST" && req.url === "/memory/query") {
        const principal = principalResolver.resolveFromHttpHeaders(req.headers, {
          requireAuthentication: true,
          allowActorOverride: true
        });
        if (!principal.ok || !principal.context) {
          respondJson(res, principal.statusCode ?? 401, {
            schemaVersion: CONTRACT_SCHEMA_VERSION,
            errorCode: principal.errorCode
          });
          return true;
        }
        const query = memoryQueryRequestSchema.parse(await readJsonBody(req));
        const decision = await queryPolicyForMemory(policyClient, {
          principalContext: principal.context,
          actionClass: "read",
          actionId: "memory.query",
          namespace: query.namespaces?.[0] ?? "memory/query",
          tenantId: query.tenantId,
          workspaceId: query.workspaceId,
          requestedCapabilities: ["memory.read"],
          trace: query.trace
        });
        if (decision.decision === "DENY") {
          respondJson(res, 403, {
            schemaVersion: CONTRACT_SCHEMA_VERSION,
            error: "policy denied",
            decision
          });
          return true;
        }
        const response = memoryPlane.queryRecords({
          query,
          principalContext: principal.context,
          policyDecisionId: decision.decisionId
        });
        respondJson(res, 200, response);
        return true;
      }
      if (req.method === "POST" && req.url === "/memory/promotions/candidates") {
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
        const request = memoryPromotionCandidateRequestSchema.parse(await readJsonBody(req));
        const decision = await queryPolicyForMemory(policyClient, {
          principalContext: principal.context,
          actionClass: "mutate-memory",
          actionId: "memory.promotion.candidate",
          namespace: request.targetNamespace,
          tenantId: principal.context.tenantId ?? "tenant-local",
          workspaceId: principal.context.workspaceId ?? "workspace-local",
          requestedCapabilities: ["memory.promote"],
          trace: request.trace,
          riskFlags: ["memory_promotion"]
        });
        if (decision.decision === "DENY" || decision.decision === "REQUIRE_APPROVAL") {
          respondJson(res, 403, {
            schemaVersion: CONTRACT_SCHEMA_VERSION,
            accepted: false,
            decision
          });
          return true;
        }
        const review = memoryPlane.createPromotionCandidate({
          request,
          principalContext: principal.context,
          policyDecisionId: decision.decisionId
        });
        respondJson(res, 201, {
          schemaVersion: CONTRACT_SCHEMA_VERSION,
          accepted: true,
          review
        });
        return true;
      }
      if (req.method === "POST" && req.url === "/memory/promotions/review") {
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
        const review = memoryPromotionReviewSchema.parse(await readJsonBody(req));
        const decision = await queryPolicyForMemory(policyClient, {
          principalContext: principal.context,
          actionClass: "approve",
          actionId: "memory.promotion.review",
          namespace: review.targetNamespace,
          tenantId: principal.context.tenantId ?? "tenant-local",
          workspaceId: principal.context.workspaceId ?? "workspace-local",
          requestedCapabilities: ["memory.promote.review"],
          trace: review.trace,
          riskFlags: ["memory_promotion_review"]
        });
        if (decision.decision === "DENY" || decision.decision === "REQUIRE_APPROVAL") {
          respondJson(res, 403, {
            schemaVersion: CONTRACT_SCHEMA_VERSION,
            accepted: false,
            decision
          });
          return true;
        }
        const result = memoryPlane.reviewPromotion({
          review,
          principalContext: principal.context,
          policyDecisionId: decision.decisionId
        });
        respondJson(res, 200, {
          schemaVersion: CONTRACT_SCHEMA_VERSION,
          accepted: true,
          ...result
        });
        return true;
      }
      if (req.method === "POST" && req.url === "/memory/context-candidates") {
        const principal = principalResolver.resolveFromHttpHeaders(req.headers, {
          requireAuthentication: true,
          allowActorOverride: true
        });
        if (!principal.ok || !principal.context) {
          respondJson(res, principal.statusCode ?? 401, {
            schemaVersion: CONTRACT_SCHEMA_VERSION,
            errorCode: principal.errorCode
          });
          return true;
        }
        const request = memoryContextCandidatesRequestSchema.parse(await readJsonBody(req));
        const response = memoryPlane.contextCandidates({
          request,
          principalContext: principal.context
        });
        respondJson(res, 200, response);
        return true;
      }
      if (req.method === "POST" && req.url === "/memory/retention/prune") {
        const principal = principalResolver.resolveFromHttpHeaders(req.headers, {
          requireAuthentication: true,
          allowActorOverride: false
        });
        if (!principal.ok || !principal.context) {
          respondJson(res, principal.statusCode ?? 401, {
            schemaVersion: CONTRACT_SCHEMA_VERSION,
            accepted: false,
            errorCode: principal.errorCode
          });
          return true;
        }
        const prune = memoryPlane.pruneExpired();
        respondJson(res, 200, {
          schemaVersion: CONTRACT_SCHEMA_VERSION,
          accepted: true,
          ...prune
        });
        return true;
      }
      if (req.method === "GET" && req.url?.startsWith("/memory/audit")) {
        const url = new URL(req.url, "http://localhost");
        const limit = Number(url.searchParams.get("limit") ?? 100);
        respondJson(res, 200, {
          schemaVersion: CONTRACT_SCHEMA_VERSION,
          events: memoryPlane.getAuditEvents(Number.isFinite(limit) ? limit : 100)
        });
        return true;
      }
      return false;
    }
  });
}

void main().catch((error) => {
  const mapped = error instanceof MemoryPlaneError ? error : undefined;
  console.error(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level: "error",
      service: "memory-service",
      message: "Service bootstrap failed",
      error: error instanceof Error ? error.message : "unknown",
      ...(mapped ? { code: mapped.code } : {})
    })
  );
  process.exit(1);
});
