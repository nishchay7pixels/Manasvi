import {
  CONTRACT_SCHEMA_VERSION,
  createCanonicalEvent,
  parseCanonicalEvent,
  principalReferenceSchema
} from "@manasvi/contracts";
import {
  InternalTokenService,
  PrincipalResolver,
  buildServicePrincipalReference
} from "@manasvi/auth";
import { EventPublisher, HttpTransport } from "@manasvi/event-bus";
import { readJsonBody, respondJson, startHttpService } from "@manasvi/service-runtime";
import { z } from "zod";

import { loadIngressServiceConfig } from "./config.js";

async function main(): Promise<void> {
  const config = await loadIngressServiceConfig();
  const servicePrincipal = buildServicePrincipalReference(config.serviceName);
  const tokenService = new InternalTokenService(
    {
      issuer: config.internalAuthIssuer,
      audience: config.internalAuthAudience,
      keyId: config.internalAuthKeyId,
      secret: config.internalAuthSigningSecret,
      ttlSeconds: config.internalAuthTokenTtlSeconds
    },
    {
      issuer: config.internalAuthIssuer,
      audience: config.internalAuthAudience,
      secretsByKeyId: {
        [config.internalAuthKeyId]: config.internalAuthSigningSecret
      }
    }
  );
  const resolver = new PrincipalResolver(tokenService);

  const publisher = new EventPublisher({
    transport: new HttpTransport({
      targetUrls: config.eventBusTargetUrls,
      timeoutMs: config.eventBusPublishTimeoutMs,
      headers: () => ({
        authorization: `Bearer ${tokenService.issueToken({
          caller: servicePrincipal,
          scopes: ["events:publish", "service:ingress"]
        })}`
      })
    }),
    ...(config.eventSigningSecret
      ? {
          signing: {
            keyId: config.signingKeyId,
            secret: config.eventSigningSecret
          }
        }
      : {})
  });

  const inboundRequestSchema = z.object({
    tenantId: z.string().min(1),
    workspaceId: z.string().min(1),
    actor: z.object({
      principalType: z.enum(["human_user", "agent", "service", "channel", "plugin", "execution_node"]),
      principalId: z.string().min(1)
    }),
    channel: z.object({
      principalType: z.literal("channel"),
      principalId: z.string().min(1),
      messageId: z.string().min(1)
    }),
    session: z
      .object({
        sessionId: z.string().min(1).optional(),
        conversationId: z.string().min(1).optional(),
        turnId: z.string().min(1).optional()
      })
      .optional(),
    text: z.string().min(1),
    metadata: z.record(z.unknown()).default({})
  });

  await startHttpService({
    config,
    serviceName: "ingress-service",
    serviceVersion: config.serviceVersion,
    readinessChecks: [
      {
        name: "config_loaded",
        check: async () => ({ ok: true })
      }
    ],
    handleRequest: async ({ req, res, logger, trace }) => {
      if (req.method === "GET" && req.url === "/") {
        respondJson(res, 200, {
          schemaVersion: CONTRACT_SCHEMA_VERSION,
          service: config.serviceName,
          plane: "ingress",
          trace
        });
        return true;
      }

      if (req.method === "POST" && req.url === "/ingress/events") {
        const incoming = inboundRequestSchema.parse(await readJsonBody(req));
        const resolved = resolver.resolveFromHttpHeaders(req.headers, {
          requireAuthentication: false,
          allowActorOverride: false
        });
        if (!resolved.ok) {
          respondJson(res, resolved.statusCode ?? 401, {
            schemaVersion: CONTRACT_SCHEMA_VERSION,
            accepted: false,
            errorCode: resolved.errorCode
          });
          return true;
        }
        const originPrincipal = resolved.context?.authenticated
          ? resolved.context?.caller
          : principalReferenceSchema.parse({
              principalType: "anonymous_external",
              principalId: "anonymous:ingress"
            });
        const normalizedEvent = createCanonicalEvent({
          eventType: "ingress.external_message.received",
          tenantId: incoming.tenantId,
          workspaceId: incoming.workspaceId,
          actor: incoming.actor,
          channel: {
            principalType: incoming.channel.principalType,
            principalId: incoming.channel.principalId
          },
          source: {
            sourceType: resolved.context?.authenticated ? "service" : "api",
            sourceId: resolved.context?.authenticated ? config.serviceName : incoming.channel.principalId,
            ...(resolved.context?.authenticated ? { sourceService: config.serviceName } : {}),
            sourceAuthenticity: {
              verified: Boolean(resolved.context?.authenticated),
              method: resolved.context?.authenticated ? "internal-auth" : "none",
              authnStrength: resolved.context?.authenticated ? "strong" : "none",
              evidenceRef: originPrincipal.principalId
            }
          },
          trace: trace,
          ...(incoming.session ? { session: incoming.session } : {}),
          payload: {
            payloadSchemaVersion: "1.0",
            channelMessageId: incoming.channel.messageId,
            text: incoming.text,
            metadata: incoming.metadata
          },
          trustClassification: "EXTERNAL_UNTRUSTED",
          risk: {
            level: "medium",
            reasons: ["external_channel_input"]
          },
          idempotencyKey: `ingress:${incoming.channel.principalId}:${incoming.channel.messageId}`,
          producer: {
            serviceName: "ingress-service",
            serviceVersion: config.serviceVersion,
            environment: config.environment
          }
        });
        const validated = parseCanonicalEvent(normalizedEvent);
        await publisher.publish(validated);
        logger.info("Published normalized ingress event", {
          eventId: validated.eventId,
          eventType: validated.eventType,
          callerPrincipalId: resolved.context?.caller.principalId,
          actorPrincipalId: validated.actor.principalId,
          sessionId: validated.session.sessionId,
          trustClassification: validated.trust.classification,
          traceId: validated.trace.traceId,
          correlationId: validated.trace.correlationId
        });
        respondJson(res, 202, {
          schemaVersion: CONTRACT_SCHEMA_VERSION,
          accepted: true,
          eventId: validated.eventId,
          eventType: validated.eventType
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
      service: "ingress-service",
      message: "Service bootstrap failed",
      error: error instanceof Error ? error.message : "unknown"
    })
  );
  process.exit(1);
});
