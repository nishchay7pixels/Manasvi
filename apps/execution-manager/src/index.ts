import {
  CONTRACT_SCHEMA_VERSION,
  approvedIntentArtifactSchema,
  executorApiRequestSchema,
  executionIntentSchema,
  runtimePolicySchema,
  type SecretUsageRecord,
  toolExecutionContractSchema
} from "@manasvi/contracts";
import {
  InternalTokenService,
  PrincipalResolver,
  buildServicePrincipalReference
} from "@manasvi/auth";
import { HttpPolicyClient } from "@manasvi/policy-sdk";
import {
  EnvMapSecretProvider,
  SecretBroker,
  parseSecretReferenceMapping,
  redactSecretsInObject
} from "@manasvi/secrets-sdk";
import { validateExecutionAuthorization } from "@manasvi/executor-sdk";
import { runSandboxedExecution } from "@manasvi/sandbox-runtime";
import { validateToolInput, validateToolOutput } from "@manasvi/tool-sdk";
import { respondJson, startHttpService } from "@manasvi/service-runtime";
import { readJsonBody } from "@manasvi/service-runtime";
import { z } from "zod";

import { loadExecutionManagerConfig } from "./config.js";
import { queryPolicyForExecution } from "./policy-integration.js";
import { deriveRuntimePolicy } from "./runtime-policy.js";
import { parseSecretErrorCode, sanitizeIncomingSecretValues } from "./secrets.js";
import { mergeRuntimePolicyWithToolHints } from "./tool-runtime-policy.js";

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
  const secretProvider = new EnvMapSecretProvider(
    process.env,
    parseSecretReferenceMapping(config.secretRefEnvMapJson)
  );
  const requestingService = {
    principalId: config.serviceName,
    principalType: "service" as const
  };
  const secretBroker = new SecretBroker({
    policyClient,
    provider: secretProvider,
    requestingService,
    onUsageRecord: (record: SecretUsageRecord) => {
      console.log(
        JSON.stringify({
          timestamp: new Date().toISOString(),
          level: "info",
          service: "execution-manager",
          message: "Secret usage record",
          secretUsage: redactSecretsInObject({
            usageId: record.usageId,
            eventType: record.eventType,
            reference: record.reference,
            consumerType: record.consumerType,
            consumerId: record.consumerId,
            tenantId: record.tenantId,
            workspaceId: record.workspaceId,
            traceId: record.trace.traceId,
            correlationId: record.trace.correlationId,
            reasonCodes: record.reasonCodes,
            metadata: record.metadata
          })
        })
      );
    }
  });
  const consumedArtifacts = new Set<string>();
  const consumedArtifactNonces = new Set<string>();
  const processedIdempotencyKeys = new Set<string>();
  const integrityAuditEvents: Array<Record<string, unknown>> = [];

  const appendIntegrityAudit = (event: Record<string, unknown>): void => {
    integrityAuditEvents.unshift({
      timestamp: new Date().toISOString(),
      service: "execution-manager",
      ...event
    });
    if (integrityAuditEvents.length > 1000) {
      integrityAuditEvents.pop();
    }
  };

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
    secretValuesByRef: z.record(z.string().min(1), z.string().min(1)).optional()
  });
  const executeToolContractRequestSchema = z.object({
    contract: toolExecutionContractSchema,
    dryRun: z.boolean().default(false),
    secretValuesByRef: z.record(z.string().min(1), z.string().min(1)).optional()
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
      if (req.method === "GET" && req.url === "/execution/audit/integrity") {
        respondJson(res, 200, {
          schemaVersion: CONTRACT_SCHEMA_VERSION,
          events: integrityAuditEvents
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
        const idempotencyToken = `${incoming.intent.snapshot.tenantId}:${incoming.intent.snapshot.workspaceId}:${incoming.intent.snapshot.idempotencyKey}`;
        if (processedIdempotencyKeys.has(idempotencyToken)) {
          appendIntegrityAudit({
            eventType: "execution.idempotency.duplicate_detected",
            intentId: incoming.intent.intentId,
            artifactId: incoming.artifact.artifactId,
            idempotencyToken,
            traceId: trace.traceId,
            correlationId: trace.correlationId
          });
          respondJson(res, 200, {
            schemaVersion: CONTRACT_SCHEMA_VERSION,
            accepted: true,
            duplicate: true,
            idempotencyToken,
            intentId: incoming.intent.intentId,
            artifactId: incoming.artifact.artifactId
          });
          return true;
        }
        const validation = validateExecutionAuthorization({
          intent: incoming.intent,
          artifact: incoming.artifact,
          verificationSecretsByKeyId: config.approvalVerificationKeys,
          intentVerificationSecretsByKeyId: config.internalAuthVerificationKeys,
          consumedArtifactIds: consumedArtifacts,
          consumedArtifactNonces
        });
        if (!validation.ok) {
          appendIntegrityAudit({
            eventType: "execution.integrity.validation_failed",
            intentId: incoming.intent.intentId,
            artifactId: incoming.artifact.artifactId,
            code: validation.code,
            message: validation.message,
            traceId: trace.traceId,
            correlationId: trace.correlationId
          });
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
        let runtimeSecretValuesByRef: Record<string, string> = {};
        if (incoming.secretValuesByRef) {
          if (!config.allowIncomingRawSecretValues) {
            respondJson(res, 422, {
              schemaVersion: CONTRACT_SCHEMA_VERSION,
              accepted: false,
              errorCode: "RAW_SECRET_VALUES_NOT_ACCEPTED"
            });
            return true;
          }
          try {
            runtimeSecretValuesByRef = sanitizeIncomingSecretValues(
              incoming.secretValuesByRef,
              runtimePolicy.secrets.allowedSecretRefs
            );
          } catch (error) {
            respondJson(res, 422, {
              schemaVersion: CONTRACT_SCHEMA_VERSION,
              accepted: false,
              errorCode: parseSecretErrorCode(error),
              error: error instanceof Error ? error.message : "invalid incoming secret reference"
            });
            return true;
          }
        }
        if (!incoming.dryRun && runtimePolicy.secrets.allowedSecretRefs.length > 0) {
          const missingRefs = runtimePolicy.secrets.allowedSecretRefs.filter(
            (reference) => !runtimeSecretValuesByRef[reference]
          );
          if (missingRefs.length > 0) {
            try {
              const resolved = await secretBroker.resolveForRuntime({
                principalContext: principal.context,
                trace,
                tenantId: incoming.intent.snapshot.tenantId,
                workspaceId: incoming.intent.snapshot.workspaceId,
                consumerType: "tool-runtime",
                consumerId: incoming.intent.snapshot.action.toolRef ?? "tool:unknown",
                purpose: "execution_runtime_injection",
                references: missingRefs,
                requestRawExposure: false,
                runtimeContext: {
                  sandboxMode: runtimePolicy.sandboxMode,
                  toolId: incoming.intent.snapshot.action.toolRef ?? "tool:unknown"
                }
              });
              runtimeSecretValuesByRef = {
                ...runtimeSecretValuesByRef,
                ...resolved.secretValuesByRef
              };
            } catch (error) {
              respondJson(res, 403, {
                schemaVersion: CONTRACT_SCHEMA_VERSION,
                accepted: false,
                errorCode: parseSecretErrorCode(error),
                error: error instanceof Error ? error.message : "secret access denied"
              });
              return true;
            }
          }
        }
        if (incoming.dryRun) {
          consumedArtifacts.add(incoming.artifact.artifactId);
          consumedArtifactNonces.add(incoming.artifact.nonce);
          processedIdempotencyKeys.add(idempotencyToken);
          appendIntegrityAudit({
            eventType: "execution.integrity.artifact_consumed",
            intentId: incoming.intent.intentId,
            artifactId: incoming.artifact.artifactId,
            nonce: incoming.artifact.nonce,
            idempotencyToken,
            dryRun: true,
            traceId: trace.traceId,
            correlationId: trace.correlationId
          });
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
          ...(Object.keys(runtimeSecretValuesByRef).length > 0
            ? { secretValuesByRef: runtimeSecretValuesByRef }
            : {}),
          sandboxRootDir: config.sandboxRootDir,
          maxOutputBytes: config.sandboxMaxOutputBytes
        });
        consumedArtifacts.add(incoming.artifact.artifactId);
        consumedArtifactNonces.add(incoming.artifact.nonce);
        processedIdempotencyKeys.add(idempotencyToken);
        appendIntegrityAudit({
          eventType: "execution.integrity.artifact_consumed",
          intentId: incoming.intent.intentId,
          artifactId: incoming.artifact.artifactId,
          nonce: incoming.artifact.nonce,
          idempotencyToken,
          dryRun: false,
          traceId: trace.traceId,
          correlationId: trace.correlationId
        });
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
      if (req.method === "POST" && req.url === "/execution/execute-tool-contract") {
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
        const incoming = executeToolContractRequestSchema.parse(await readJsonBody(req));
        const idempotencyToken = `${incoming.contract.intent.snapshot.tenantId}:${incoming.contract.intent.snapshot.workspaceId}:${incoming.contract.intent.snapshot.idempotencyKey}`;
        if (processedIdempotencyKeys.has(idempotencyToken)) {
          appendIntegrityAudit({
            eventType: "execution.idempotency.duplicate_detected",
            intentId: incoming.contract.intent.intentId,
            artifactId: incoming.contract.artifact.artifactId,
            idempotencyToken,
            traceId: trace.traceId,
            correlationId: trace.correlationId
          });
          respondJson(res, 200, {
            schemaVersion: CONTRACT_SCHEMA_VERSION,
            accepted: true,
            duplicate: true,
            idempotencyToken,
            intentId: incoming.contract.intent.intentId,
            artifactId: incoming.contract.artifact.artifactId
          });
          return true;
        }
        if (incoming.contract.invocation.caller.principalId !== principal.context.caller.principalId) {
          respondJson(res, 403, {
            schemaVersion: CONTRACT_SCHEMA_VERSION,
            accepted: false,
            errorCode: "CALLER_CONTEXT_MISMATCH"
          });
          return true;
        }
        if (incoming.contract.manifest.status !== "enabled") {
          respondJson(res, 409, {
            schemaVersion: CONTRACT_SCHEMA_VERSION,
            accepted: false,
            errorCode: "TOOL_NOT_ENABLED"
          });
          return true;
        }
        const validation = validateExecutionAuthorization({
          intent: incoming.contract.intent,
          artifact: incoming.contract.artifact,
          verificationSecretsByKeyId: config.approvalVerificationKeys,
          intentVerificationSecretsByKeyId: config.internalAuthVerificationKeys,
          consumedArtifactIds: consumedArtifacts,
          consumedArtifactNonces
        });
        if (!validation.ok) {
          appendIntegrityAudit({
            eventType: "execution.integrity.validation_failed",
            intentId: incoming.contract.intent.intentId,
            artifactId: incoming.contract.artifact.artifactId,
            code: validation.code,
            message: validation.message,
            traceId: trace.traceId,
            correlationId: trace.correlationId
          });
          respondJson(res, 422, {
            schemaVersion: CONTRACT_SCHEMA_VERSION,
            accepted: false,
            errorCode: validation.code,
            error: validation.message
          });
          return true;
        }
        let validatedInput: Record<string, unknown>;
        try {
          validatedInput = validateToolInput(incoming.contract.manifest.toolId, incoming.contract.invocation.input);
        } catch (error) {
          respondJson(res, 422, {
            schemaVersion: CONTRACT_SCHEMA_VERSION,
            accepted: false,
            errorCode: "TOOL_INPUT_VALIDATION_FAILED",
            error: error instanceof Error ? error.message : "invalid tool input"
          });
          return true;
        }
        if (
          incoming.contract.intent.snapshot.action.toolRef !== incoming.contract.manifest.runtimeBinding.toolRef ||
          incoming.contract.intent.snapshot.action.operation !== incoming.contract.manifest.runtimeBinding.operation
        ) {
          respondJson(res, 422, {
            schemaVersion: CONTRACT_SCHEMA_VERSION,
            accepted: false,
            errorCode: "TOOL_RUNTIME_BINDING_MISMATCH"
          });
          return true;
        }
        const decision = await queryPolicyForExecution(policyClient, {
          principalContext: principal.context,
          actionClass: incoming.contract.intent.snapshot.action.actionClass,
          actionId: incoming.contract.intent.snapshot.action.actionId,
          resource: incoming.contract.intent.snapshot.target,
          requestedCapabilities: incoming.contract.intent.snapshot.requiredCapabilities,
          tenantId: incoming.contract.intent.snapshot.tenantId,
          workspaceId: incoming.contract.intent.snapshot.workspaceId,
          trace,
          approvalPresent: incoming.contract.artifact.approvalState === "approved",
          skipApprovalRequested: false,
          riskFlags: incoming.contract.intent.snapshot.risk.reasons,
          riskDeclaredLevel: incoming.contract.intent.snapshot.risk.level
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
        const baseRuntimePolicy = deriveRuntimePolicy({
          intent: incoming.contract.intent,
          artifact: incoming.contract.artifact,
          policyDecision: decision,
          sandboxProfileDefault: config.sandboxProfileDefault,
          egressWhitelistPolicy: config.egressWhitelistPolicy
        });
        const runtimePolicy = mergeRuntimePolicyWithToolHints({
          baseRuntimePolicy,
          toolContract: incoming.contract
        });
        const runId = `run:${Date.now()}:${Math.random().toString(16).slice(2, 10)}`;
        const executionToken = tokenService.issueToken({
          caller: buildServicePrincipalReference(config.serviceName),
          subject: { principalId: incoming.contract.intent.intentId, principalType: "tool" },
          scopes: [`execution.run:${runId}`, "execution.runtime.invoke"],
          tenantId: incoming.contract.intent.snapshot.tenantId,
          workspaceId: incoming.contract.intent.snapshot.workspaceId,
          ttlSeconds: config.executionTokenTtlSeconds
        });
        const runtimeRequest = executorApiRequestSchema.parse({
          schemaVersion: "1.0",
          runId,
          intentId: incoming.contract.intent.intentId,
          artifactId: incoming.contract.artifact.artifactId,
          toolRef: incoming.contract.manifest.runtimeBinding.toolRef,
          operation: incoming.contract.manifest.runtimeBinding.operation,
          parameters: validatedInput,
          runtimePolicy,
          executionToken,
          trace
        });
        let runtimeSecretValuesByRef: Record<string, string> = {};
        if (incoming.secretValuesByRef) {
          if (!config.allowIncomingRawSecretValues) {
            respondJson(res, 422, {
              schemaVersion: CONTRACT_SCHEMA_VERSION,
              accepted: false,
              errorCode: "RAW_SECRET_VALUES_NOT_ACCEPTED"
            });
            return true;
          }
          try {
            runtimeSecretValuesByRef = sanitizeIncomingSecretValues(
              incoming.secretValuesByRef,
              runtimePolicy.secrets.allowedSecretRefs
            );
          } catch (error) {
            respondJson(res, 422, {
              schemaVersion: CONTRACT_SCHEMA_VERSION,
              accepted: false,
              errorCode: parseSecretErrorCode(error),
              error: error instanceof Error ? error.message : "invalid incoming secret reference"
            });
            return true;
          }
        }
        if (!incoming.dryRun && runtimePolicy.secrets.allowedSecretRefs.length > 0) {
          const missingRefs = runtimePolicy.secrets.allowedSecretRefs.filter(
            (reference) => !runtimeSecretValuesByRef[reference]
          );
          if (missingRefs.length > 0) {
            try {
              const resolved = await secretBroker.resolveForRuntime({
                principalContext: principal.context,
                trace,
                tenantId: incoming.contract.intent.snapshot.tenantId,
                workspaceId: incoming.contract.intent.snapshot.workspaceId,
                consumerType: "tool-runtime",
                consumerId: incoming.contract.manifest.toolId,
                purpose: "tool_contract_runtime_injection",
                references: missingRefs,
                requestRawExposure: false,
                runtimeContext: {
                  sandboxMode: runtimePolicy.sandboxMode,
                  toolId: incoming.contract.manifest.toolId
                }
              });
              runtimeSecretValuesByRef = {
                ...runtimeSecretValuesByRef,
                ...resolved.secretValuesByRef
              };
            } catch (error) {
              respondJson(res, 403, {
                schemaVersion: CONTRACT_SCHEMA_VERSION,
                accepted: false,
                errorCode: parseSecretErrorCode(error),
                error: error instanceof Error ? error.message : "secret access denied"
              });
              return true;
            }
          }
        }
        if (incoming.dryRun) {
          consumedArtifacts.add(incoming.contract.artifact.artifactId);
          consumedArtifactNonces.add(incoming.contract.artifact.nonce);
          processedIdempotencyKeys.add(idempotencyToken);
          appendIntegrityAudit({
            eventType: "execution.integrity.artifact_consumed",
            intentId: incoming.contract.intent.intentId,
            artifactId: incoming.contract.artifact.artifactId,
            nonce: incoming.contract.artifact.nonce,
            idempotencyToken,
            dryRun: true,
            traceId: trace.traceId,
            correlationId: trace.correlationId
          });
          respondJson(res, 202, {
            schemaVersion: CONTRACT_SCHEMA_VERSION,
            accepted: true,
            dryRun: true,
            runId,
            intentId: incoming.contract.intent.intentId,
            artifactId: incoming.contract.artifact.artifactId,
            runtimePolicy
          });
          return true;
        }
        const run = await runSandboxedExecution({
          request: runtimeRequest,
          tokenService,
          decisionAuditRecordId: decision.auditRecordId,
          executionAuditEventId: `exec-audit:${runId}`,
          ...(Object.keys(runtimeSecretValuesByRef).length > 0
            ? { secretValuesByRef: runtimeSecretValuesByRef }
            : {}),
          sandboxRootDir: config.sandboxRootDir,
          maxOutputBytes: config.sandboxMaxOutputBytes
        });
        consumedArtifacts.add(incoming.contract.artifact.artifactId);
        consumedArtifactNonces.add(incoming.contract.artifact.nonce);
        processedIdempotencyKeys.add(idempotencyToken);
        appendIntegrityAudit({
          eventType: "execution.integrity.artifact_consumed",
          intentId: incoming.contract.intent.intentId,
          artifactId: incoming.contract.artifact.artifactId,
          nonce: incoming.contract.artifact.nonce,
          idempotencyToken,
          dryRun: false,
          traceId: trace.traceId,
          correlationId: trace.correlationId
        });
        let validatedOutput: Record<string, unknown> | undefined;
        if (run.artifact.status === "completed") {
          try {
            validatedOutput = validateToolOutput(incoming.contract.manifest.toolId, run.artifact.result);
          } catch (error) {
            respondJson(res, 422, {
              schemaVersion: CONTRACT_SCHEMA_VERSION,
              accepted: false,
              errorCode: "TOOL_OUTPUT_VALIDATION_FAILED",
              error: error instanceof Error ? error.message : "invalid tool output",
              runId,
              resultArtifact: run.artifact
            });
            return true;
          }
        }
        respondJson(res, 202, {
          schemaVersion: CONTRACT_SCHEMA_VERSION,
          accepted: true,
          dryRun: false,
          runId,
          intentId: incoming.contract.intent.intentId,
          artifactId: incoming.contract.artifact.artifactId,
          decision,
          resultArtifact: run.artifact,
          ...(validatedOutput ? { toolOutput: validatedOutput } : {})
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
