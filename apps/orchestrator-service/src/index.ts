import { CONTRACT_SCHEMA_VERSION } from "@manasvi/contracts";
import {
  InternalTokenService,
  PrincipalResolver,
  buildServicePrincipalReference,
  resolvePrincipalContextFromEvent
} from "@manasvi/auth";
import { EventConsumer, InMemoryDeadLetterStore, RetryableError } from "@manasvi/event-bus";
import { HttpPolicyClient } from "@manasvi/policy-sdk";
import { ContextAssembler, InMemorySessionStore } from "@manasvi/session-sdk";
import { readJsonBody, respondJson, startHttpService } from "@manasvi/service-runtime";
import { z } from "zod";

import { loadOrchestratorServiceConfig } from "./config.js";
import { queryPolicyForOrchestration } from "./policy-integration.js";

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
  const deadLetterStore = new InMemoryDeadLetterStore();
  const consumer = new EventConsumer({
    deadLetterStore,
    maxAttempts: config.maxEventHandlerAttempts,
    requireSignedInternalEvents: config.requireSignedInternalEvents,
    signingSecretsByKeyId: config.eventSigningSecretsByKeyId
  });

  consumer.subscribe("ingress.external_message.received", async (event, context) => {
    const principalContext = resolvePrincipalContextFromEvent({ event });
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
      tokenBudget: config.sessionContextTokenBudget
    });
    // Placeholder for full orchestration logic in later milestones.
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
