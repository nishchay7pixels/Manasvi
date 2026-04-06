import { CONTRACT_SCHEMA_VERSION } from "@manasvi/contracts";
import {
  InternalTokenService,
  PrincipalResolver,
  resolvePrincipalContextFromEvent
} from "@manasvi/auth";
import { EventConsumer, InMemoryDeadLetterStore, RetryableError } from "@manasvi/event-bus";
import { readJsonBody, respondJson, startHttpService } from "@manasvi/service-runtime";

import { loadOrchestratorServiceConfig } from "./config.js";

async function main(): Promise<void> {
  const config = await loadOrchestratorServiceConfig();
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
  const deadLetterStore = new InMemoryDeadLetterStore();
  const consumer = new EventConsumer({
    deadLetterStore,
    maxAttempts: config.maxEventHandlerAttempts,
    requireSignedInternalEvents: config.requireSignedInternalEvents,
    signingSecretsByKeyId: config.eventSigningSecretsByKeyId
  });

  consumer.subscribe("ingress.external_message.received", async (event, context) => {
    const principalContext = resolvePrincipalContextFromEvent({ event });
    const payload = event.payload as { text?: string };
    if (!payload.text || payload.text.length === 0) {
      throw new RetryableError("Empty text payload is retryable while upstream normalizer settles");
    }
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
        traceId: event.trace.traceId,
        correlationId: event.trace.correlationId,
        attempt: context.attempt
      })
    );
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
        logger.info("Plan request accepted (placeholder)");
        respondJson(res, 202, {
          schemaVersion: CONTRACT_SCHEMA_VERSION,
          queued: true
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
