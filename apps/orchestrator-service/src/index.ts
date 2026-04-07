import {
  CONTRACT_SCHEMA_VERSION,
  actionClassSchema,
  executionIntentSchema,
  type MemoryContextCandidatesResponse,
  policyResourceReferenceSchema,
  toolManifestSchema,
  resolvedPrincipalContextSchema
} from "@manasvi/contracts";
import {
  InternalTokenService,
  PrincipalResolver,
  buildServicePrincipalReference
} from "@manasvi/auth";
import { EventConsumer, InMemoryDeadLetterStore, RetryableError } from "@manasvi/event-bus";
import { createModelAdapter } from "@manasvi/model-adapter";
import { HttpMemoryClient } from "@manasvi/memory-sdk";
import { HttpPolicyClient } from "@manasvi/policy-sdk";
import { ContextAssembler, InMemorySessionStore, type ContextSourceInput } from "@manasvi/session-sdk";
import {
  buildGovernedToolExecutionContract,
  createGovernedToolInvocation,
  createToolResult,
  validateToolInput,
  validateToolOutput
} from "@manasvi/tool-sdk";
import { InMemoryToolRegistry } from "@manasvi/tool-registry";
import { readJsonBody, respondJson, startHttpService } from "@manasvi/service-runtime";
import { z } from "zod";

import { loadOrchestratorServiceConfig } from "./config.js";
import { AdapterBackedPlannerProvider, GovernedAgentRuntime } from "./agent-runtime.js";
import { buildExecutionIntentFromPolicy } from "./intent-planner.js";
import { buildHarnessEventResultRecord, buildModelInvocationRequest, type HarnessEventResultRecord } from "./model-integration.js";
import { queryPolicyForOrchestration } from "./policy-integration.js";

function memoryRecordToContextSource(input: {
  record: {
    recordId: string;
    memoryClass: string;
    trustClassification: ContextSourceInput["trustClassification"];
    contentType: string;
    content: { text?: string | undefined; data: Record<string, unknown> };
    provenance: {
      sourceType: string;
      sourceId: string;
      sourceRef: string;
      originatingPrincipal?: ContextSourceInput["originatingPrincipal"] | undefined;
      originatingService?: string | undefined;
      createdAt: string;
      linkedSessionId?: string | undefined;
      derivation: {
        derived: boolean;
        derivationType?: string | undefined;
        derivedFromRecordIds: string[];
        derivedFromSourceRefs: string[];
      };
    };
  };
  sessionId: string;
}): ContextSourceInput {
  const sourceType =
    input.record.memoryClass === "UNTRUSTED_EXTERNAL"
      ? "retrieved-web-content"
      : input.record.memoryClass === "ORG_SHARED_TRUSTED"
        ? "shared-memory"
        : input.record.memoryClass === "AUDIT_ACTION_HISTORY"
          ? "risk-annotation"
          : "user-memory";
  const content =
    input.record.content.text ??
    JSON.stringify(input.record.content.data ?? {});
  return {
    sourceType,
    sourceId: input.record.recordId,
    sourceRef: `memory:${input.record.recordId}`,
    content,
    contentCategory: "memory-fact",
    trustClassification: input.record.trustClassification,
    ...(input.record.provenance.originatingPrincipal
      ? { originatingPrincipal: input.record.provenance.originatingPrincipal }
      : {}),
    ...(input.record.provenance.originatingService
      ? { originatingService: input.record.provenance.originatingService }
      : {}),
    observedAt: input.record.provenance.createdAt,
    sessionId: input.sessionId,
    metadata: {
      memoryClass: input.record.memoryClass,
      contentType: input.record.contentType
    },
    transformation: {
      transformed: input.record.provenance.derivation.derived,
      ...(input.record.provenance.derivation.derivationType
        ? { transformType: input.record.provenance.derivation.derivationType }
        : {}),
      derivedFromChunkIds: input.record.provenance.derivation.derivedFromRecordIds,
      derivedFromSourceRefs: input.record.provenance.derivation.derivedFromSourceRefs
    }
  };
}

async function main(): Promise<void> {
  const config = await loadOrchestratorServiceConfig();
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
  const sessionStore = new InMemorySessionStore();
  const contextAssembler = new ContextAssembler(sessionStore, {
    recentMessageLimit: config.sessionRecentMessageLimit
  });
  const servicePrincipal = buildServicePrincipalReference(config.serviceName);
  const policyClient = new HttpPolicyClient({
    baseUrl: config.policyServiceBaseUrl,
    getAuthToken: () =>
      tokenService.issueToken({
        caller: servicePrincipal,
        scopes: ["policy.evaluate", "service:orchestrator"]
      })
  });
  const memoryClient = new HttpMemoryClient({
    baseUrl: config.memoryServiceBaseUrl,
    getAuthToken: () =>
      tokenService.issueToken({
        caller: servicePrincipal,
        scopes: ["memory.read", "memory.write", "memory.promote", "service:orchestrator"],
        tenantId: "tenant-local",
        workspaceId: "workspace-local"
      })
  });
  const modelAdapter = createModelAdapter({
    mode: config.modelAdapterMode,
    model: config.plannerModel,
    timeoutMs: config.modelAdapterTimeoutMs,
    ...(config.openAiApiKey ? { openAiApiKey: config.openAiApiKey } : {}),
    openAiBaseUrl: config.openAiBaseUrl,
    ollamaBaseUrl: config.ollamaBaseUrl
  });
  const harnessEventResults = new Map<string, HarnessEventResultRecord>();
  const executionIntents = new Map<string, z.infer<typeof executionIntentSchema>>();
  const toolRegistry = new InMemoryToolRegistry({ preloadBuiltIns: true });
  const harnessResultTtlMs = config.harnessEventResultTtlSeconds * 1000;

  const upsertHarnessEventResult = (record: HarnessEventResultRecord): void => {
    harnessEventResults.set(record.eventId, record);
    const cutoff = Date.now() - harnessResultTtlMs;
    for (const [eventId, existing] of harnessEventResults.entries()) {
      if (new Date(existing.completedAt).getTime() < cutoff) {
        harnessEventResults.delete(eventId);
      }
    }
  };
  const deadLetterStore = new InMemoryDeadLetterStore();
  const consumer = new EventConsumer({
    deadLetterStore,
    maxAttempts: config.maxEventHandlerAttempts,
    requireSignedInternalEvents: config.requireSignedInternalEvents,
    signingSecretsByKeyId: config.eventSigningSecretsByKeyId
  });

  consumer.subscribe("ingress.external_message.received", async (event, context) => {
    const principalContext = resolvedPrincipalContextSchema.parse({
      caller: servicePrincipal,
      actor: event.actor,
      origin: event.channel,
      tenantId: event.tenantId,
      workspaceId: event.workspaceId,
      authnStrength: "strong",
      authenticated: true,
      scopes: []
    });
    const decision = await queryPolicyForOrchestration(policyClient, {
      principalContext,
      actionClass: "invoke",
      actionId: "orchestration.ingress-event.plan",
      resource: {
        resourceClass: "agent-definition",
        resourceId: "agent:default-planner",
        tenantId: event.tenantId,
        workspaceId: event.workspaceId,
        attributes: {}
      },
      requestedCapabilities: ["agent.invoke"],
      tenantId: event.tenantId,
      workspaceId: event.workspaceId,
      trace: event.trace,
      ...(event.session.sessionId ? { sessionId: event.session.sessionId } : {}),
      riskFlags: event.risk.reasons
    });
    if (decision.decision !== "ALLOW" && decision.decision !== "CONDITIONAL_ALLOW") {
      console.log(
        JSON.stringify({
          timestamp: new Date().toISOString(),
          level: "warn",
          service: "orchestrator-service",
          message: "Policy blocked orchestration for ingress event",
          eventId: event.eventId,
          decision: decision.decision,
          reasonCodes: decision.reasonCodes,
          auditRecordId: decision.auditRecordId
        })
      );
      return;
    }
    const payload = event.payload as { text?: string };
    if (!payload.text || payload.text.length === 0) {
      throw new RetryableError("Empty text payload is retryable while upstream normalizer settles");
    }
    const memoryCandidates: MemoryContextCandidatesResponse = await memoryClient.getContextCandidates({
      schemaVersion: "1.0",
      tenantId: event.tenantId,
      workspaceId: event.workspaceId,
      actorPrincipal: principalContext.actor,
      callerPrincipal: principalContext.caller,
      ...(event.session.sessionId ? { sessionId: event.session.sessionId } : {}),
      queryText: payload.text,
      maxPerClass: 3,
      trace: event.trace
    }).catch(() => ({
      schemaVersion: "1.0" as const,
      records: [],
      trace: event.trace
    }));
    const assembledContext = await contextAssembler.assembleForMessage({
      message: {
        messageId: event.eventId,
        text: payload.text,
        sender: event.actor,
        trustClassification: event.trust.classification,
        sourceRef: `event:${event.eventId}`,
        createdAt: event.timestamp
      },
      sessionResolve: {
        tenantId: event.tenantId,
        workspaceId: event.workspaceId,
        isolationMode: config.sessionDefaultIsolationMode,
        sessionType: "channel_thread",
        owner: event.actor,
        createdBy: servicePrincipal,
        participants: [event.channel],
        ...(event.session.sessionId ? { explicitSessionId: event.session.sessionId } : {}),
        channelBinding: {
          channelPrincipal: event.channel,
          ...(event.session.conversationId
            ? { externalConversationId: event.session.conversationId }
            : {}),
          ...(event.session.turnId ? { externalThreadId: event.session.turnId } : {})
        },
        resolutionHint: `event:${event.eventId}`
      },
      trace: {
        traceId: event.trace.traceId,
        correlationId: event.trace.correlationId,
        ...(event.trace.parentTraceId ? { parentTraceId: event.trace.parentTraceId } : {})
      },
      systemInstructions: [
        "Session is context hygiene only. Authorization still requires principal and policy."
      ],
      policyNotes: [`policy-decision:${decision.decision}:${decision.reasonCodes.join(",")}`],
      additionalSources: memoryCandidates.records.map((record) =>
        memoryRecordToContextSource({
          record,
          sessionId: event.session.sessionId ?? `session:pending:${event.eventId}`
        })
      ),
      tokenBudget: config.sessionContextTokenBudget
    });
    const modelRequest = buildModelInvocationRequest({
      messageId: event.eventId,
      traceId: event.trace.traceId,
      correlationId: event.trace.correlationId,
      userInput: payload.text,
      assembledContext,
      maxContextChunks: config.modelAdapterMaxContextChunks
    });
    try {
      const modelResponse = await modelAdapter.invoke(modelRequest);
      await memoryClient.createRecord({
        schemaVersion: "1.0",
        memoryClass: "EPHEMERAL_SESSION",
        namespace: `session/${assembledContext.session.sessionId}`,
        tenantId: event.tenantId,
        workspaceId: event.workspaceId,
        ownerPrincipal: principalContext.actor,
        trustClassification: "USER_OWNED",
        contentType: "text/plain",
        content: {
          text: payload.text,
          data: {}
        },
        tags: ["session-message", "context-source"],
        provenance: {
          sourceType: "session-message",
          sourceId: event.eventId,
          sourceRef: `event:${event.eventId}`,
          originatingPrincipal: principalContext.actor,
          originatingService: "orchestrator-service",
          createdAt: new Date().toISOString(),
          linkedSessionId: assembledContext.session.sessionId,
          linkedMessageId: event.eventId,
          derivation: {
            derived: false,
            derivedFromRecordIds: [],
            derivedFromSourceRefs: []
          }
        },
        sourceReferences: [`event:${event.eventId}`],
        trace: event.trace
      }).catch(() => undefined);
      await memoryClient.createRecord({
        schemaVersion: "1.0",
        memoryClass: "AUDIT_ACTION_HISTORY",
        namespace: `audit/${event.eventId}`,
        tenantId: event.tenantId,
        workspaceId: event.workspaceId,
        ownerPrincipal: principalContext.actor,
        trustClassification: "AUDIT_SECURITY",
        contentType: "application/json",
        content: {
          data: {
            modelProvider: modelResponse.provider,
            model: modelResponse.model,
            latencyMs: modelResponse.latencyMs,
            policyDecision: decision.decision
          }
        },
        tags: ["audit-linked", "model-response"],
        provenance: {
          sourceType: "audit-event-reference",
          sourceId: event.eventId,
          sourceRef: `event:${event.eventId}`,
          originatingPrincipal: principalContext.actor,
          originatingService: "orchestrator-service",
          createdAt: new Date().toISOString(),
          linkedSessionId: assembledContext.session.sessionId,
          linkedMessageId: event.eventId,
          linkedAuditRecordId: decision.auditRecordId,
          derivation: {
            derived: true,
            derivationType: "execution-summary",
            derivedFromRecordIds: [],
            derivedFromSourceRefs: [`event:${event.eventId}`]
          }
        },
        sourceReferences: [`audit:${decision.auditRecordId}`],
        trace: event.trace
      }).catch(() => undefined);
      upsertHarnessEventResult(
        buildHarnessEventResultRecord({
          eventId: event.eventId,
          assembledContext,
          principalContext,
          traceId: event.trace.traceId,
          correlationId: event.trace.correlationId,
          policyDecision: decision.decision,
          policyReasonCodes: decision.reasonCodes,
          auditRecordId: decision.auditRecordId,
          modelResponse
        })
      );
      console.log(
        JSON.stringify({
          timestamp: new Date().toISOString(),
          level: "info",
          service: "orchestrator-service",
          message: "Model adapter generated response",
          eventId: event.eventId,
          mode: modelResponse.mode,
          provider: modelResponse.provider,
          model: modelResponse.model,
          latencyMs: modelResponse.latencyMs,
          sessionId: assembledContext.session.sessionId,
          contextTraceId: assembledContext.trace.traceId,
          traceId: event.trace.traceId,
          correlationId: event.trace.correlationId
        })
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown model adapter error";
      upsertHarnessEventResult(
        buildHarnessEventResultRecord({
          eventId: event.eventId,
          assembledContext,
          principalContext,
          traceId: event.trace.traceId,
          correlationId: event.trace.correlationId,
          policyDecision: decision.decision,
          policyReasonCodes: decision.reasonCodes,
          auditRecordId: decision.auditRecordId,
          errorMessage: message
        })
      );
      console.error(
        JSON.stringify({
          timestamp: new Date().toISOString(),
          level: "error",
          service: "orchestrator-service",
          message: "Model adapter invocation failed",
          eventId: event.eventId,
          error: message,
          sessionId: assembledContext.session.sessionId,
          contextTraceId: assembledContext.trace.traceId,
          traceId: event.trace.traceId,
          correlationId: event.trace.correlationId
        })
      );
    }
    console.log(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "info",
        service: "orchestrator-service",
        message: "Consumed ingress external message event",
        eventId: event.eventId,
        eventType: event.eventType,
        tenantId: event.tenantId,
        workspaceId: event.workspaceId,
        trustClassification: event.trust.classification,
        sourceType: event.source.sourceType,
        sourceId: event.source.sourceId,
        callerPrincipalId: principalContext.caller.principalId,
        actorPrincipalId: principalContext.actor.principalId,
        sessionId: assembledContext.session.sessionId,
        contextTraceId: assembledContext.trace.traceId,
        includedChunkCount: assembledContext.chunks.length,
        sessionRiskLevel: assembledContext.session.riskProfile.level,
        traceId: event.trace.traceId,
        correlationId: event.trace.correlationId,
        attempt: context.attempt
      })
    );
  });

  const planRequestSchema = z.object({
    tenantId: z.string().min(1),
    workspaceId: z.string().min(1),
    messageText: z.string().min(1),
    sessionId: z.string().min(1).optional(),
    actionId: z.string().min(1).default("orchestration.plan.invoke-agent"),
    riskFlags: z.array(z.string().min(1)).default([])
  });
  const intentCreationSchema = z.object({
    tenantId: z.string().min(1),
    workspaceId: z.string().min(1),
    sessionId: z.string().min(1).optional(),
    action: z.object({
      actionId: z.string().min(1),
      actionClass: actionClassSchema,
      operation: z.string().min(1),
      toolRef: z.string().min(1).optional(),
      parameters: z.record(z.unknown()).default({})
    }),
    target: policyResourceReferenceSchema,
    requiredCapabilities: z.array(z.string().min(1)).default([]),
    riskFlags: z.array(z.string().min(1)).default([]),
    riskDeclaredLevel: z.enum(["low", "medium", "high", "critical"]).optional(),
    idempotencyKey: z.string().min(1).optional()
  });
  const approvalDecisionSchema = z.object({
    intentId: z.string().min(1),
    approvalRequestId: z.string().min(1),
    decision: z.enum(["approved", "rejected"]),
    reason: z.string().min(1).optional()
  });
  const registerToolSchema = z.object({
    manifest: toolManifestSchema
  });
  const updateToolStatusSchema = z.object({
    toolId: z.string().min(1),
    version: z.string().min(1),
    status: z.enum(["enabled", "disabled", "deprecated"])
  });
  const invokeToolSchema = z.object({
    tenantId: z.string().min(1),
    workspaceId: z.string().min(1),
    toolId: z.string().min(1),
    toolVersion: z.string().min(1).optional(),
    sessionId: z.string().min(1).optional(),
    input: z.record(z.unknown()),
    requestedSecretRefs: z.array(z.string().min(1)).default([]),
    riskFlags: z.array(z.string().min(1)).default([]),
    dryRun: z.boolean().default(false)
  });
  const agentTurnRequestSchema = z.object({
    tenantId: z.string().min(1),
    workspaceId: z.string().min(1),
    messageText: z.string().min(1),
    sessionId: z.string().min(1).optional(),
    maxIterations: z.number().int().positive().max(20).optional(),
    maxConsecutiveFailures: z.number().int().positive().max(10).optional(),
    strictPlannerParsing: z.boolean().optional(),
    approvalSimulation: z.enum(["pending", "approved", "rejected"]).optional()
  });

  const issueServiceToken = (scopes: string[]): string =>
    tokenService.issueToken({
      caller: servicePrincipal,
      scopes
    });

  const createApprovalRequest = async (intent: z.infer<typeof executionIntentSchema>) => {
    const response = await fetch(`${config.approvalServiceBaseUrl}/approvals/requests`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${issueServiceToken(["approval.request.create", "service:orchestrator"])}`
      },
      body: JSON.stringify({
        intent
      })
    });
    if (!response.ok) {
      throw new Error(`Approval request creation failed with status ${response.status}: ${await response.text()}`);
    }
    const body = await response.json() as { request: { approvalRequestId: string } };
    return body.request;
  };

  const issueSystemArtifact = async (intent: z.infer<typeof executionIntentSchema>) => {
    const response = await fetch(`${config.approvalServiceBaseUrl}/approvals/artifacts/issue-system`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${issueServiceToken(["approval.artifact.issue", "service:orchestrator"])}`
      },
      body: JSON.stringify({
        intent,
        reason: "policy_no_human_approval_required"
      })
    });
    if (!response.ok) {
      throw new Error(`System artifact issuance failed with status ${response.status}: ${await response.text()}`);
    }
    return response.json();
  };

  const executeToolContract = async (contract: ReturnType<typeof buildGovernedToolExecutionContract>, dryRun: boolean) => {
    const response = await fetch(`${config.executionManagerBaseUrl}/execution/execute-tool-contract`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${issueServiceToken(["execution.intent.execute", "service:orchestrator"])}`
      },
      body: JSON.stringify({
        contract,
        dryRun
      })
    });
    const body = await response.json();
    if (!response.ok) {
      throw new Error(`Tool execution failed with status ${response.status}: ${JSON.stringify(body)}`);
    }
    return body;
  };
  const plannerProvider = new AdapterBackedPlannerProvider(modelAdapter);
  const agentRuntime = new GovernedAgentRuntime({
    policyClient,
    memoryClient,
    contextAssembler,
    plannerProvider,
    toolRegistry,
    servicePrincipal,
    createApprovalRequest,
    issueSystemArtifact,
    executeToolContract
  });

  await startHttpService({
    config,
    serviceName: "orchestrator-service",
    serviceVersion: config.serviceVersion,
    readinessChecks: [
      { name: "config_loaded", check: async () => ({ ok: true }) },
      { name: "planner_runtime_initialized", check: async () => ({ ok: true }) }
    ],
    handleRequest: async ({ req, res, trace, logger }) => {
      if (req.method === "GET" && req.url === "/") {
        respondJson(res, 200, {
          schemaVersion: CONTRACT_SCHEMA_VERSION,
          service: config.serviceName,
          plane: "orchestration",
          trace
        });
        return true;
      }
      if (req.method === "GET" && req.url?.startsWith("/tools/metadata")) {
        const principal = principalResolver.resolveFromHttpHeaders(req.headers, {
          requireAuthentication: true,
          allowActorOverride: false
        });
        if (!principal.ok) {
          respondJson(res, principal.statusCode ?? 401, {
            schemaVersion: CONTRACT_SCHEMA_VERSION,
            errorCode: principal.errorCode
          });
          return true;
        }
        const url = new URL(req.url, "http://localhost");
        const toolId = url.searchParams.get("toolId");
        const version = url.searchParams.get("version");
        if (toolId) {
          const entry = toolRegistry.resolve(toolId, version ?? undefined);
          if (!entry) {
            respondJson(res, 404, {
              schemaVersion: CONTRACT_SCHEMA_VERSION,
              error: "tool not found"
            });
            return true;
          }
          respondJson(res, 200, {
            schemaVersion: CONTRACT_SCHEMA_VERSION,
            tool: entry,
            explorer: toolRegistry.metadataExplorer().find((item) => item.toolId === entry.toolId && item.version === entry.version)
          });
          return true;
        }
        const statusParam = url.searchParams.get("status");
        const status =
          statusParam === "registered" || statusParam === "enabled" || statusParam === "disabled" || statusParam === "deprecated"
            ? statusParam
            : undefined;
        respondJson(res, 200, {
          schemaVersion: CONTRACT_SCHEMA_VERSION,
          count: toolRegistry.list({ ...(status ? { status } : {}) }).length,
          tools: toolRegistry.metadataExplorer({ ...(status ? { status } : {}) })
        });
        return true;
      }
      if (req.method === "POST" && req.url === "/tools/register") {
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
        const incoming = registerToolSchema.parse(await readJsonBody(req));
        const entry = toolRegistry.register({
          manifest: incoming.manifest,
          registeredBy: principal.context.actor
        });
        logger.info("Tool registered", {
          toolId: entry.toolId,
          version: entry.version,
          actionClass: entry.manifest.actionClass,
          sideEffectClass: entry.manifest.sideEffectClass,
          traceId: trace.traceId,
          correlationId: trace.correlationId
        });
        respondJson(res, 201, {
          schemaVersion: CONTRACT_SCHEMA_VERSION,
          accepted: true,
          entry
        });
        return true;
      }
      if (req.method === "POST" && req.url === "/tools/status") {
        const principal = principalResolver.resolveFromHttpHeaders(req.headers, {
          requireAuthentication: true,
          allowActorOverride: true
        });
        if (!principal.ok) {
          respondJson(res, principal.statusCode ?? 401, {
            schemaVersion: CONTRACT_SCHEMA_VERSION,
            accepted: false,
            errorCode: principal.errorCode
          });
          return true;
        }
        const incoming = updateToolStatusSchema.parse(await readJsonBody(req));
        const entry = toolRegistry.setStatus(incoming);
        respondJson(res, 200, {
          schemaVersion: CONTRACT_SCHEMA_VERSION,
          accepted: true,
          entry
        });
        return true;
      }
      if (req.method === "POST" && req.url === "/tools/invoke") {
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
        const incoming = invokeToolSchema.parse(await readJsonBody(req));
        const registryEntry = toolRegistry.resolve(incoming.toolId, incoming.toolVersion);
        if (!registryEntry) {
          respondJson(res, 404, {
            schemaVersion: CONTRACT_SCHEMA_VERSION,
            accepted: false,
            errorCode: "TOOL_NOT_REGISTERED"
          });
          return true;
        }
        if (registryEntry.status !== "enabled") {
          respondJson(res, 409, {
            schemaVersion: CONTRACT_SCHEMA_VERSION,
            accepted: false,
            errorCode: "TOOL_NOT_ENABLED"
          });
          return true;
        }
        let validatedInput: Record<string, unknown>;
        try {
          validatedInput = validateToolInput(registryEntry.toolId, incoming.input);
        } catch (error) {
          const result = createToolResult({
            invocationId: `tool-invocation:invalid:${Date.now()}`,
            toolId: registryEntry.toolId,
            toolVersion: registryEntry.version,
            status: "validation_failed",
            output: {},
            error: {
              code: "TOOL_INPUT_VALIDATION_FAILED",
              message: error instanceof Error ? error.message : "invalid tool input"
            },
            provenance: {
              source: "orchestrator-service",
              trustClassification: "CONTROL_TRUSTED"
            },
            runtime: {},
            trace
          });
          respondJson(res, 422, {
            schemaVersion: CONTRACT_SCHEMA_VERSION,
            accepted: false,
            result
          });
          return true;
        }
        const decision = await queryPolicyForOrchestration(policyClient, {
          principalContext: principal.context,
          actionClass: registryEntry.manifest.policyBinding.policyActionClass,
          actionId: `tool.invoke.${registryEntry.toolId}`,
          resource: {
            ...registryEntry.manifest.policyBinding.resource,
            tenantId: incoming.tenantId,
            workspaceId: incoming.workspaceId,
            attributes: {
              toolId: registryEntry.toolId,
              sideEffectClass: registryEntry.manifest.sideEffectClass,
              mutability: registryEntry.manifest.mutability
            }
          },
          requestedCapabilities: registryEntry.manifest.capabilities.map((item) => item.capabilityId),
          tenantId: incoming.tenantId,
          workspaceId: incoming.workspaceId,
          trace,
          ...(incoming.sessionId ? { sessionId: incoming.sessionId } : {}),
          riskFlags: [...incoming.riskFlags, ...registryEntry.manifest.tags]
        });
        if (decision.decision === "DENY") {
          const result = createToolResult({
            invocationId: `tool-invocation:denied:${Date.now()}`,
            toolId: registryEntry.toolId,
            toolVersion: registryEntry.version,
            status: "policy_denied",
            output: {},
            error: {
              code: "POLICY_DENIED",
              message: decision.reasonCodes.join(",")
            },
            provenance: {
              source: "policy-service",
              trustClassification: "CONTROL_TRUSTED"
            },
            runtime: {},
            trace
          });
          respondJson(res, 403, {
            schemaVersion: CONTRACT_SCHEMA_VERSION,
            accepted: false,
            decision,
            result
          });
          return true;
        }

        const invocation = createGovernedToolInvocation({
          toolId: registryEntry.toolId,
          toolVersion: registryEntry.version,
          tenantId: incoming.tenantId,
          workspaceId: incoming.workspaceId,
          actor: principal.context.actor,
          caller: principal.context.caller,
          ...(incoming.sessionId ? { sessionId: incoming.sessionId } : {}),
          input: validatedInput,
          requestedSecretRefs: incoming.requestedSecretRefs,
          trace
        });
        const intent = buildExecutionIntentFromPolicy({
          decision,
          principalContext: principal.context,
          tenantId: incoming.tenantId,
          workspaceId: incoming.workspaceId,
          ...(incoming.sessionId ? { sessionId: incoming.sessionId } : {}),
          trace,
          action: {
            actionId: `tool.invoke.${registryEntry.toolId}`,
            actionClass: registryEntry.manifest.policyBinding.policyActionClass,
            operation: registryEntry.manifest.runtimeBinding.operation,
            toolRef: registryEntry.manifest.runtimeBinding.toolRef,
            parameters: validatedInput
          },
          target: {
            ...registryEntry.manifest.policyBinding.resource,
            tenantId: incoming.tenantId,
            workspaceId: incoming.workspaceId,
            attributes: {
              toolId: registryEntry.toolId
            }
          },
          requiredCapabilities: registryEntry.manifest.capabilities.map((item) => item.capabilityId),
          ttlSeconds: config.executionIntentTtlSeconds,
          idempotencyKey: invocation.invocationId
        });
        executionIntents.set(intent.intentId, intent);
        if (decision.approvalRequired) {
          const requestResult = await createApprovalRequest(intent);
          const pendingIntent = executionIntentSchema.parse({
            ...intent,
            approval: {
              ...intent.approval,
              approvalRequestId: requestResult.approvalRequestId
            },
            updatedAt: new Date().toISOString()
          });
          executionIntents.set(pendingIntent.intentId, pendingIntent);
          respondJson(res, 202, {
            schemaVersion: CONTRACT_SCHEMA_VERSION,
            accepted: true,
            pendingApproval: true,
            toolId: registryEntry.toolId,
            invocation,
            intent: pendingIntent,
            decision,
            approvalRequestId: requestResult.approvalRequestId
          });
          return true;
        }
        const artifactResult = await issueSystemArtifact(intent);
        const contract = buildGovernedToolExecutionContract({
          manifest: registryEntry.manifest,
          invocation,
          intent,
          artifact: artifactResult.artifact,
          trace
        });
        const execution = await executeToolContract(contract, incoming.dryRun);
        if (execution?.toolOutput) {
          try {
            validateToolOutput(registryEntry.toolId, execution.toolOutput);
          } catch (error) {
            respondJson(res, 422, {
              schemaVersion: CONTRACT_SCHEMA_VERSION,
              accepted: false,
              errorCode: "TOOL_OUTPUT_VALIDATION_FAILED",
              error: error instanceof Error ? error.message : "tool output validation failed",
              decision,
              intent,
              execution
            });
            return true;
          }
        }
        respondJson(res, 202, {
          schemaVersion: CONTRACT_SCHEMA_VERSION,
          accepted: true,
          pendingApproval: false,
          toolId: registryEntry.toolId,
          invocation,
          intent,
          decision,
          artifact: artifactResult.artifact,
          execution
        });
        return true;
      }
      if (req.method === "POST" && req.url === "/agent-runtime/turn") {
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
        const incoming = agentTurnRequestSchema.parse(await readJsonBody(req));
        const run = await agentRuntime.runTurn({
          tenantId: incoming.tenantId,
          workspaceId: incoming.workspaceId,
          messageText: incoming.messageText,
          principalContext: principal.context,
          trace,
          ...(incoming.sessionId ? { sessionId: incoming.sessionId } : {}),
          config: {
            maxIterations: incoming.maxIterations ?? config.agentLoopMaxIterations,
            maxConsecutiveFailures: incoming.maxConsecutiveFailures ?? config.agentLoopMaxConsecutiveFailures,
            strictPlannerParsing: incoming.strictPlannerParsing ?? config.agentLoopStrictPlannerParsing
          },
          approvalSimulation: incoming.approvalSimulation ?? "pending"
        });
        logger.info("Agent runtime turn processed", {
          runId: run.runId,
          state: run.state,
          outcome: run.outcome.status,
          iterations: run.iterations,
          sessionId: run.session.sessionId,
          traceId: run.trace.traceId,
          correlationId: run.trace.correlationId
        });
        respondJson(
          res,
          run.outcome.status === "completed"
            ? 200
            : run.outcome.status === "awaiting_approval"
              ? 202
              : run.outcome.status === "halted_denied"
                ? 403
                : 500,
          {
            schemaVersion: CONTRACT_SCHEMA_VERSION,
            accepted: run.outcome.status === "completed",
            run
          }
        );
        return true;
      }
      if (req.method === "POST" && req.url === "/orchestration/plan") {
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
        const incoming = planRequestSchema.parse(await readJsonBody(req));
        const decision = await queryPolicyForOrchestration(policyClient, {
          principalContext: principal.context,
          actionClass: "invoke",
          actionId: incoming.actionId,
          resource: {
            resourceClass: "agent-definition",
            resourceId: "agent:default-planner",
            tenantId: incoming.tenantId,
            workspaceId: incoming.workspaceId,
            attributes: {}
          },
          requestedCapabilities: ["agent.invoke"],
          tenantId: incoming.tenantId,
          workspaceId: incoming.workspaceId,
          trace,
          ...(incoming.sessionId ? { sessionId: incoming.sessionId } : {}),
          riskFlags: incoming.riskFlags
        });
        const memoryCandidates: MemoryContextCandidatesResponse = await memoryClient.getContextCandidates({
          schemaVersion: "1.0",
          tenantId: incoming.tenantId,
          workspaceId: incoming.workspaceId,
          actorPrincipal: principal.context.actor,
          callerPrincipal: principal.context.caller,
          ...(incoming.sessionId ? { sessionId: incoming.sessionId } : {}),
          queryText: incoming.messageText,
          maxPerClass: 2,
          trace
        }).catch(() => ({
          schemaVersion: "1.0" as const,
          records: [],
          trace
        }));
        const assembledContext = await contextAssembler.assembleForMessage({
          message: {
            messageId: `plan:${Date.now()}`,
            text: incoming.messageText,
            sender: principal.context.actor,
            trustClassification: "USER_OWNED",
            sourceRef: "orchestration.plan.request"
          },
          sessionResolve: {
            tenantId: incoming.tenantId,
            workspaceId: incoming.workspaceId,
            isolationMode: config.sessionDefaultIsolationMode,
            sessionType: "user_interaction",
            owner: principal.context.actor,
            createdBy: servicePrincipal,
            participants: [principal.context.caller],
            ...(incoming.sessionId ? { explicitSessionId: incoming.sessionId } : {}),
            resolutionHint: principal.context.actor.principalId
          },
          trace: {
            traceId: trace.traceId,
            correlationId: trace.correlationId,
            ...(trace.parentTraceId ? { parentTraceId: trace.parentTraceId } : {})
          },
          systemInstructions: [
            "Session membership does not grant privileges. Policy evaluation governs authorization."
          ],
          policyNotes: [`policy-decision:${decision.decision}`],
          additionalSources: memoryCandidates.records.map((record) =>
            memoryRecordToContextSource({
              record,
              sessionId: incoming.sessionId ?? `session:pending:plan`
            })
          ),
          tokenBudget: config.sessionContextTokenBudget
        });
        logger.info("Policy evaluated orchestration plan request", {
          decision: decision.decision,
          reasonCodes: decision.reasonCodes,
          auditRecordId: decision.auditRecordId,
          sessionId: assembledContext.session.sessionId,
          contextTraceId: assembledContext.trace.traceId
        });
        if (decision.decision === "DENY") {
          respondJson(res, 403, {
            schemaVersion: CONTRACT_SCHEMA_VERSION,
            queued: false,
            decision,
            sessionId: assembledContext.session.sessionId,
            contextTraceId: assembledContext.trace.traceId
          });
          return true;
        }
        respondJson(res, 202, {
          schemaVersion: CONTRACT_SCHEMA_VERSION,
          queued: true,
          decision,
          sessionId: assembledContext.session.sessionId,
          contextTraceId: assembledContext.trace.traceId,
          contextChunkCount: assembledContext.chunks.length
        });
        return true;
      }
      if (req.method === "GET" && req.url?.startsWith("/orchestration/context-traces")) {
        const url = new URL(req.url, "http://localhost");
        const sessionId = url.searchParams.get("sessionId");
        if (!sessionId) {
          respondJson(res, 400, {
            schemaVersion: CONTRACT_SCHEMA_VERSION,
            error: "sessionId query parameter is required"
          });
          return true;
        }
        const traces = await sessionStore.listContextTraces({ sessionId, limit: 100 });
        respondJson(res, 200, {
          schemaVersion: CONTRACT_SCHEMA_VERSION,
          traces
        });
        return true;
      }
      if (req.method === "GET" && req.url?.startsWith("/orchestration/sessions")) {
        const url = new URL(req.url, "http://localhost");
        const sessionId = url.searchParams.get("sessionId");
        if (!sessionId) {
          respondJson(res, 400, {
            schemaVersion: CONTRACT_SCHEMA_VERSION,
            error: "sessionId query parameter is required"
          });
          return true;
        }
        const session = await sessionStore.getSessionById(sessionId);
        if (!session) {
          respondJson(res, 404, {
            schemaVersion: CONTRACT_SCHEMA_VERSION,
            error: "session not found"
          });
          return true;
        }
        const messages = await sessionStore.listSessionMessages({ sessionId, limit: 50 });
        respondJson(res, 200, {
          schemaVersion: CONTRACT_SCHEMA_VERSION,
          session,
          messages
        });
        return true;
      }
      if (req.method === "GET" && req.url?.startsWith("/orchestration/event-results")) {
        const principal = principalResolver.resolveFromHttpHeaders(req.headers, {
          requireAuthentication: true,
          allowActorOverride: false
        });
        if (!principal.ok) {
          respondJson(res, principal.statusCode ?? 401, {
            schemaVersion: CONTRACT_SCHEMA_VERSION,
            errorCode: principal.errorCode
          });
          return true;
        }
        const url = new URL(req.url, "http://localhost");
        const eventId = url.searchParams.get("eventId");
        if (!eventId) {
          respondJson(res, 400, {
            schemaVersion: CONTRACT_SCHEMA_VERSION,
            error: "eventId query parameter is required"
          });
          return true;
        }
        const result = harnessEventResults.get(eventId);
        if (!result) {
          respondJson(res, 404, {
            schemaVersion: CONTRACT_SCHEMA_VERSION,
            status: "pending",
            eventId
          });
          return true;
        }
        respondJson(res, result.status === "completed" ? 200 : 502, {
          schemaVersion: CONTRACT_SCHEMA_VERSION,
          result
        });
        return true;
      }
      if (req.method === "POST" && req.url === "/orchestration/execution-intents") {
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
        const incoming = intentCreationSchema.parse(await readJsonBody(req));
        const decision = await queryPolicyForOrchestration(policyClient, {
          principalContext: principal.context,
          actionClass: incoming.action.actionClass,
          actionId: incoming.action.actionId,
          resource: incoming.target,
          requestedCapabilities: incoming.requiredCapabilities,
          tenantId: incoming.tenantId,
          workspaceId: incoming.workspaceId,
          trace,
          ...(incoming.sessionId ? { sessionId: incoming.sessionId } : {}),
          riskFlags: incoming.riskFlags,
          ...(incoming.riskDeclaredLevel ? { riskDeclaredLevel: incoming.riskDeclaredLevel } : {})
        });

        const baseIntent = buildExecutionIntentFromPolicy({
          decision,
          principalContext: principal.context,
          tenantId: incoming.tenantId,
          workspaceId: incoming.workspaceId,
          ...(incoming.sessionId ? { sessionId: incoming.sessionId } : {}),
          trace,
          action: {
            actionId: incoming.action.actionId,
            actionClass: incoming.action.actionClass,
            operation: incoming.action.operation,
            parameters: incoming.action.parameters,
            ...(incoming.action.toolRef ? { toolRef: incoming.action.toolRef } : {})
          },
          target: incoming.target,
          requiredCapabilities: incoming.requiredCapabilities,
          ttlSeconds: config.executionIntentTtlSeconds,
          ...(incoming.idempotencyKey ? { idempotencyKey: incoming.idempotencyKey } : {})
        });
        let intent = baseIntent;
        executionIntents.set(intent.intentId, intent);

        if (decision.decision === "DENY") {
          respondJson(res, 403, {
            schemaVersion: CONTRACT_SCHEMA_VERSION,
            accepted: false,
            intent,
            decision
          });
          return true;
        }

        if (decision.approvalRequired) {
          const requestResult = await createApprovalRequest(intent);
          intent = executionIntentSchema.parse({
            ...intent,
            approval: {
              ...intent.approval,
              approvalRequestId: requestResult.approvalRequestId
            },
            updatedAt: new Date().toISOString()
          });
          executionIntents.set(intent.intentId, intent);
          respondJson(res, 202, {
            schemaVersion: CONTRACT_SCHEMA_VERSION,
            accepted: true,
            intent,
            decision,
            approvalRequestId: requestResult.approvalRequestId
          });
          return true;
        }

        const artifactResult = await issueSystemArtifact(intent);
        respondJson(res, 201, {
          schemaVersion: CONTRACT_SCHEMA_VERSION,
          accepted: true,
          intent,
          decision,
          artifact: artifactResult.artifact,
          approvalRecord: artifactResult.approvalRecord
        });
        return true;
      }
      if (req.method === "POST" && req.url === "/orchestration/execution-intents/approval-decision") {
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
        const incoming = approvalDecisionSchema.parse(await readJsonBody(req));
        const intent = executionIntents.get(incoming.intentId);
        if (!intent) {
          respondJson(res, 404, {
            schemaVersion: CONTRACT_SCHEMA_VERSION,
            error: "intent not found"
          });
          return true;
        }
        const response = await fetch(`${config.approvalServiceBaseUrl}/approvals/requests/decision`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${issueServiceToken(["approval.request.decide", "service:orchestrator"])}`
          },
          body: JSON.stringify({
            approvalRequestId: incoming.approvalRequestId,
            intent,
            decision: {
              decision: incoming.decision,
              decidedBy: principal.context.actor,
              decidedAt: new Date().toISOString(),
              ...(incoming.reason ? { reason: incoming.reason } : {}),
              trace
            }
          })
        });
        const body = await response.json();
        if (!response.ok) {
          respondJson(res, response.status, {
            schemaVersion: CONTRACT_SCHEMA_VERSION,
            error: body
          });
          return true;
        }
        const updatedIntent = executionIntentSchema.parse({
          ...intent,
          approval: {
            ...intent.approval,
            state: incoming.decision === "approved" ? "approved" : "rejected",
            ...(incoming.decision === "approved" ? { approvedBy: principal.context.actor } : {}),
            ...(incoming.decision === "approved" ? { approvedAt: new Date().toISOString() } : {})
          },
          lifecycle: incoming.decision === "approved" ? "execution_authorized" : "rejected",
          updatedAt: new Date().toISOString()
        });
        executionIntents.set(updatedIntent.intentId, updatedIntent);
        respondJson(res, 200, {
          schemaVersion: CONTRACT_SCHEMA_VERSION,
          intent: updatedIntent,
          approval: body
        });
        return true;
      }
      if (req.method === "GET" && req.url?.startsWith("/orchestration/execution-intents")) {
        const url = new URL(req.url, "http://localhost");
        const intentId = url.searchParams.get("intentId");
        if (!intentId) {
          respondJson(res, 400, {
            schemaVersion: CONTRACT_SCHEMA_VERSION,
            error: "intentId query parameter is required"
          });
          return true;
        }
        const intent = executionIntents.get(intentId);
        if (!intent) {
          respondJson(res, 404, {
            schemaVersion: CONTRACT_SCHEMA_VERSION,
            error: "intent not found"
          });
          return true;
        }
        const artifactResponse = await fetch(
          `${config.approvalServiceBaseUrl}/approvals/artifacts?intentId=${encodeURIComponent(intentId)}`,
          {
            method: "GET",
            headers: {
              authorization: `Bearer ${issueServiceToken(["approval.artifact.read", "service:orchestrator"])}`
            }
          }
        );
        const artifactBody = artifactResponse.ok ? await artifactResponse.json() : undefined;
        respondJson(res, 200, {
          schemaVersion: CONTRACT_SCHEMA_VERSION,
          intent,
          ...(artifactBody?.artifact ? { artifact: artifactBody.artifact } : {})
        });
        return true;
      }
      if (req.method === "POST" && req.url === "/internal/events") {
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
        const event = await readJsonBody(req);
        const outcome = await consumer.consumeRaw(event);
        if (outcome === "dead-lettered") {
          respondJson(res, 422, {
            schemaVersion: CONTRACT_SCHEMA_VERSION,
            accepted: false,
            outcome,
            deadLetterCount: deadLetterStore.records.length
          });
          return true;
        }
        respondJson(res, 202, {
          schemaVersion: CONTRACT_SCHEMA_VERSION,
          accepted: true,
          outcome,
          callerPrincipalId: principal.context?.caller.principalId
        });
        return true;
      }
      if (req.method === "GET" && req.url === "/internal/dead-letter") {
        respondJson(res, 200, {
          schemaVersion: CONTRACT_SCHEMA_VERSION,
          deadLetters: deadLetterStore.records
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
      service: "orchestrator-service",
      message: "Service bootstrap failed",
      error: error instanceof Error ? error.message : "unknown"
    })
  );
  process.exit(1);
});
