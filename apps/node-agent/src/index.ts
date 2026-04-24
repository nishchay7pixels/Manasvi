import {
  CONTRACT_SCHEMA_VERSION,
  executorApiRequestSchema,
  nodeDispatchRequestSchema,
  nodeDispatchResultSchema
} from "@manasvi/contracts";
import { InternalTokenService, PrincipalResolver, buildServicePrincipalReference } from "@manasvi/auth";
import { validateExecutionAuthorization } from "@manasvi/executor-sdk";
import { runSandboxedExecution } from "@manasvi/sandbox-runtime";
import { readJsonBody, respondJson, startHttpService } from "@manasvi/service-runtime";
import { validateToolInput, validateToolOutput } from "@manasvi/tool-sdk";

import { loadNodeAgentConfig } from "./config.js";

async function main(): Promise<void> {
  const config = await loadNodeAgentConfig();
  const servicePrincipal = buildServicePrincipalReference(config.serviceName);
  const dispatchTokenVerifier = new InternalTokenService(
    {
      issuer: config.nodeDispatchIssuer,
      audience: config.nodeDispatchAudience,
      keyId: Object.keys(config.nodeDispatchVerificationKeys)[0]!,
      secret: Object.values(config.nodeDispatchVerificationKeys)[0]!,
      ttlSeconds: 120
    },
    {
      issuer: config.nodeDispatchIssuer,
      audience: config.nodeDispatchAudience,
      secretsByKeyId: config.nodeDispatchVerificationKeys
    }
  );
  const runtimeTokenService = new InternalTokenService(
    {
      issuer: "manasvi.internal.auth",
      audience: "manasvi.internal.services",
      keyId: config.runtimeTokenKeyId,
      secret: config.runtimeTokenSigningSecret,
      ttlSeconds: 120
    },
    {
      issuer: "manasvi.internal.auth",
      audience: "manasvi.internal.services",
      secretsByKeyId: config.runtimeTokenVerificationKeys
    }
  );
  const principalResolver = new PrincipalResolver(runtimeTokenService);

  await startHttpService({
    config,
    serviceName: "node-agent",
    serviceVersion: config.serviceVersion,
    readinessChecks: [{ name: "sandbox_runtime_initialized", check: async () => ({ ok: true }) }],
    handleRequest: async ({ req, res, trace, logger }) => {
      if (req.method === "GET" && req.url === "/") {
        respondJson(res, 200, {
          schemaVersion: CONTRACT_SCHEMA_VERSION,
          service: config.serviceName,
          nodeId: config.nodeId,
          trace
        });
        return true;
      }
      if (req.method === "POST" && req.url === "/node-agent/dispatch") {
        const authHeader = req.headers.authorization;
        const bearer = typeof authHeader === "string" && authHeader.startsWith("Bearer ")
          ? authHeader.slice("Bearer ".length)
          : undefined;
        const verified = dispatchTokenVerifier.verifyToken(bearer);
        if (!verified.ok || !verified.claims.scopes.includes("node.dispatch.accept")) {
          respondJson(res, 401, {
            schemaVersion: "1.0",
            accepted: false,
            errorCode: "INVALID_DISPATCH_TOKEN"
          });
          return true;
        }
        const incoming = nodeDispatchRequestSchema.parse(await readJsonBody(req));
        if (incoming.nodeId !== config.nodeId) {
          respondJson(res, 403, {
            schemaVersion: "1.0",
            accepted: false,
            errorCode: "NODE_TARGET_MISMATCH"
          });
          return true;
        }
        if (Date.parse(incoming.expiresAt) < Date.now()) {
          respondJson(res, 422, {
            schemaVersion: "1.0",
            accepted: false,
            errorCode: "DISPATCH_EXPIRED"
          });
          return true;
        }
        const validation = validateExecutionAuthorization({
          intent: incoming.executionIntent,
          artifact: incoming.approvedArtifact,
          verificationSecretsByKeyId: config.runtimeTokenVerificationKeys,
          consumedArtifactIds: new Set<string>()
        });
        if (!validation.ok) {
          respondJson(res, 422, {
            schemaVersion: "1.0",
            accepted: false,
            errorCode: validation.code
          });
          return true;
        }
        try {
          const input = validateToolInput(
            incoming.toolContract.manifest.toolId,
            incoming.toolContract.invocation.input
          );
          const runId = `node-run:${Date.now()}:${Math.random().toString(16).slice(2, 8)}`;
          const executionToken = runtimeTokenService.issueToken({
            caller: servicePrincipal,
            subject: incoming.executionIntent.snapshot.actor,
            scopes: ["execution.runtime.invoke", `execution.run:${runId}`],
            tenantId: incoming.executionIntent.snapshot.tenantId,
            workspaceId: incoming.executionIntent.snapshot.workspaceId,
            ttlSeconds: 120
          });
          const runtimeRequest = executorApiRequestSchema.parse({
            schemaVersion: "1.0",
            runId,
            intentId: incoming.executionIntent.intentId,
            artifactId: incoming.approvedArtifact.artifactId,
            toolRef: incoming.toolContract.manifest.runtimeBinding.toolRef,
            operation: incoming.toolContract.manifest.runtimeBinding.operation,
            parameters: input,
            runtimePolicy: incoming.runtimePolicy,
            executionToken,
            trace: incoming.trace
          });
          const run = await runSandboxedExecution({
            request: runtimeRequest,
            tokenService: runtimeTokenService,
            decisionAuditRecordId: incoming.executionIntent.snapshot.policy.auditRecordId,
            executionAuditEventId: `node-exec-audit:${runId}`,
            sandboxRootDir: config.sandboxRootDir,
            maxOutputBytes: config.sandboxMaxOutputBytes
          });
          validateToolOutput(
            incoming.toolContract.manifest.toolId,
            run.artifact.result as Record<string, unknown>
          );
          const response = nodeDispatchResultSchema.parse({
            schemaVersion: "1.0",
            dispatchId: incoming.dispatchId,
            nodeId: config.nodeId,
            accepted: true,
            status: run.artifact.status === "completed" ? "completed" : "failed",
            runId,
            resultArtifactId: run.artifact.artifactId,
            trace: incoming.trace
          });
          logger.info("Node dispatch executed", {
            dispatchId: incoming.dispatchId,
            runId,
            status: run.artifact.status,
            traceId: trace.traceId
          });
          respondJson(res, 202, {
            schemaVersion: "1.0",
            accepted: true,
            dispatch: response,
            resultArtifact: run.artifact
          });
          return true;
        } catch (error) {
          const response = nodeDispatchResultSchema.parse({
            schemaVersion: "1.0",
            dispatchId: incoming.dispatchId,
            nodeId: config.nodeId,
            accepted: false,
            status: "validation_failed",
            reasonCode: error instanceof Error ? error.message : "dispatch_execution_failed",
            trace: incoming.trace
          });
          respondJson(res, 422, {
            schemaVersion: "1.0",
            accepted: false,
            dispatch: response
          });
          return true;
        }
      }
      if (req.method === "POST" && req.url === "/node-agent/heartbeat/send") {
        const principal = principalResolver.resolveFromHttpHeaders(req.headers, {
          requireAuthentication: true,
          allowActorOverride: false
        });
        if (!principal.ok) {
          respondJson(res, principal.statusCode ?? 401, {
            schemaVersion: "1.0",
            accepted: false,
            errorCode: principal.errorCode
          });
          return true;
        }
        const body = (await readJsonBody(req)) as {
          nodeCredentialToken: string;
          load?: { activeRuns: number; cpuPct: number; memoryPct: number };
          runtimeVersion?: string;
        };
        const response = await fetch(`${config.nodeManagerBaseUrl.replace(/\/$/, "")}/nodes/heartbeat`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${body.nodeCredentialToken}`,
            "x-trace-id": trace.traceId,
            "x-correlation-id": trace.correlationId
          },
          body: JSON.stringify({
            status: "healthy",
            runtimeVersion: body.runtimeVersion ?? "node-agent/1.0.0",
            load: body.load ?? { activeRuns: 0, cpuPct: 0, memoryPct: 0 },
            attestationFresh: true
          })
        });
        const payload = await response.json();
        respondJson(res, response.ok ? 202 : 502, {
          schemaVersion: "1.0",
          accepted: response.ok,
          nodeManagerResponse: payload
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
      service: "node-agent",
      message: "Service bootstrap failed",
      error: error instanceof Error ? error.message : "unknown"
    })
  );
  process.exit(1);
});
