import {
  CONTRACT_SCHEMA_VERSION,
  approvedIntentArtifactSchema,
  executorApiRequestSchema,
  executionIntentSchema
} from "@manasvi/contracts";
import {
  InternalTokenService,
  PrincipalResolver,
  buildServicePrincipalReference
} from "@manasvi/auth";
import { HttpPolicyClient } from "@manasvi/policy-sdk";
import { validateExecutionAuthorization } from "@manasvi/executor-sdk";
import { runSandboxedExecution } from "@manasvi/sandbox-runtime";
import { respondJson, startHttpService } from "@manasvi/service-runtime";
import { readJsonBody } from "@manasvi/service-runtime";
import { z } from "zod";

import { loadExecutionManagerConfig } from "./config.js";
import { queryPolicyForExecution } from "./policy-integration.js";
import { deriveRuntimePolicy } from "./runtime-policy.js";

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
  const consumedArtifacts = new Set<string>();

  const dispatchRequestSchema = z.object({
    tenantId: z.string().min(1),
    workspaceId: z.string().min(1),
    executionNodeId: z.string().min(1),
    actionId: z.string().min(1).default("execution.dispatch"),
    requestedCapabilities: z.array(z.string().min(1)).default(["node.execute"]),
    riskFlags: z.array(z.string().min(1)).default([]),
    skipApprovalRequested: z.boolean().default(false)
  });
  const executeIntentSchema = z.object({
    intent: executionIntentSchema,
    artifact: approvedIntentArtifactSchema,
    dryRun: z.boolean().default(false),
    secretValuesByRef: z.record(z.string().min(1)).optional()
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
      if (req.method === "POST" && req.url === "/execution/execute-intent") {
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
        const incoming = executeIntentSchema.parse(await readJsonBody(req));
        const validation = validateExecutionAuthorization({
          intent: incoming.intent,
          artifact: incoming.artifact,
          verificationSecretsByKeyId: config.approvalVerificationKeys,
          consumedArtifactIds: consumedArtifacts
        });
        if (!validation.ok) {
          logger.warn("Execution intent validation failed", {
            intentId: incoming.intent.intentId,
            artifactId: incoming.artifact.artifactId,
            code: validation.code,
            message: validation.message
          });
          respondJson(res, 422, {
            schemaVersion: CONTRACT_SCHEMA_VERSION,
            accepted: false,
            errorCode: validation.code,
            error: validation.message
          });
          return true;
        }

        const decision = await queryPolicyForExecution(policyClient, {
          principalContext: principal.context,
          actionClass: incoming.intent.snapshot.action.actionClass,
          actionId: incoming.intent.snapshot.action.actionId,
          resource: incoming.intent.snapshot.target,
          requestedCapabilities: incoming.intent.snapshot.requiredCapabilities,
          tenantId: incoming.intent.snapshot.tenantId,
          workspaceId: incoming.intent.snapshot.workspaceId,
          trace,
          approvalPresent: incoming.artifact.approvalState === "approved",
          skipApprovalRequested: false,
          riskFlags: incoming.intent.snapshot.risk.reasons,
          riskDeclaredLevel: incoming.intent.snapshot.risk.level
        });
        if (decision.decision === "DENY" || decision.decision === "REQUIRE_APPROVAL") {
          respondJson(res, 403, {
            schemaVersion: CONTRACT_SCHEMA_VERSION,
            accepted: false,
            validation: {
              code: "POLICY_BLOCKED_EXECUTION",
              detail: decision
            }
          });
          return true;
        }
        const runtimePolicy = deriveRuntimePolicy({
          intent: incoming.intent,
          artifact: incoming.artifact,
          policyDecision: decision,
          sandboxProfileDefault: config.sandboxProfileDefault,
          egressWhitelistPolicy: config.egressWhitelistPolicy
        });
        const runId = `run:${Date.now()}:${Math.random().toString(16).slice(2, 10)}`;
        const executionToken = tokenService.issueToken({
          caller: buildServicePrincipalReference(config.serviceName),
          subject: { principalId: incoming.intent.intentId, principalType: "tool" },
          scopes: [`execution.run:${runId}`, "execution.runtime.invoke"],
          tenantId: incoming.intent.snapshot.tenantId,
          workspaceId: incoming.intent.snapshot.workspaceId,
          ttlSeconds: config.executionTokenTtlSeconds
        });
        const runtimeRequest = executorApiRequestSchema.parse({
          schemaVersion: "1.0",
          runId,
          intentId: incoming.intent.intentId,
          artifactId: incoming.artifact.artifactId,
          toolRef: incoming.intent.snapshot.action.toolRef ?? "tool:echo",
          operation: incoming.intent.snapshot.action.operation,
          parameters: incoming.intent.snapshot.action.parameters,
          runtimePolicy,
          executionToken,
          trace
        });

        logger.info("Execution runtime policy derived", {
          runId,
          intentId: incoming.intent.intentId,
          artifactId: incoming.artifact.artifactId,
          sandboxMode: runtimePolicy.sandboxMode,
          timeoutMs: runtimePolicy.timeoutMs,
          cpuTimeLimitSeconds: runtimePolicy.cpuTimeLimitSeconds,
          memoryLimitMb: runtimePolicy.memoryLimitMb
        });
        if (incoming.dryRun) {
          consumedArtifacts.add(incoming.artifact.artifactId);
          respondJson(res, 202, {
            schemaVersion: CONTRACT_SCHEMA_VERSION,
            accepted: true,
            executionId: `exec:${Date.now()}`,
            dryRun: true,
            runId,
            intentId: incoming.intent.intentId,
            artifactId: incoming.artifact.artifactId,
            runtimePolicy,
            decision
          });
          return true;
        }

        const run = await runSandboxedExecution({
          request: runtimeRequest,
          tokenService,
          decisionAuditRecordId: decision.auditRecordId,
          executionAuditEventId: `exec-audit:${runId}`,
          ...(incoming.secretValuesByRef ? { secretValuesByRef: incoming.secretValuesByRef } : {}),
          sandboxRootDir: config.sandboxRootDir,
          maxOutputBytes: config.sandboxMaxOutputBytes
        });
        consumedArtifacts.add(incoming.artifact.artifactId);
        for (const logEvent of run.logs) {
          logger.info("Execution runtime event", {
            runId,
            intentId: logEvent.intentId,
            stage: logEvent.stage,
            sandboxMode: logEvent.sandboxMode,
            metadata: logEvent.metadata
          });
        }
        respondJson(res, 202, {
          schemaVersion: CONTRACT_SCHEMA_VERSION,
          accepted: true,
          executionId: `exec:${Date.now()}`,
          dryRun: false,
          runId,
          intentId: incoming.intent.intentId,
          artifactId: incoming.artifact.artifactId,
          decision,
          resultArtifact: run.artifact
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
