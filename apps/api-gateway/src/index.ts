import { CONTRACT_SCHEMA_VERSION } from "@manasvi/contracts";
import { InternalTokenService, buildServicePrincipalReference } from "@manasvi/auth";
import { readJsonBody, respondJson, startHttpService } from "@manasvi/service-runtime";
import { z } from "zod";

import { loadApiGatewayConfig } from "./config.js";
import { buildIngressSubmission, pollForEventResult } from "./harness.js";

const harnessRequestSchema = z.object({
  tenantId: z.string().min(1),
  workspaceId: z.string().min(1),
  message: z.string().min(1),
  actorPrincipalId: z.string().min(1).optional(),
  actorPrincipalType: z.enum(["human_user", "agent"]).optional(),
  channelPrincipalId: z.string().min(1).optional(),
  channelMessageId: z.string().min(1).optional(),
  sessionId: z.string().min(1).optional(),
  conversationId: z.string().min(1).optional()
});

async function main(): Promise<void> {
  const config = await loadApiGatewayConfig();
  const servicePrincipal = buildServicePrincipalReference(config.serviceName);
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
      secretsByKeyId: {
        [config.internalAuthKeyId]: config.internalAuthSigningSecret
      }
    }
  );

  const issueServiceToken = (scopes: string[]): string =>
    tokenService.issueToken({
      caller: servicePrincipal,
      scopes
    });

  await startHttpService({
    config,
    serviceName: "api-gateway",
    serviceVersion: config.serviceVersion,
    readinessChecks: [{ name: "routing_table_initialized", check: async () => ({ ok: true }) }],
    handleRequest: async ({ req, res, trace, logger }) => {
      if (req.method === "GET" && req.url === "/") {
        respondJson(res, 200, {
          schemaVersion: CONTRACT_SCHEMA_VERSION,
          service: config.serviceName,
          plane: "gateway",
          trace
        });
        return true;
      }
      if (req.method === "GET" && req.url === "/routes") {
        respondJson(res, 200, {
          schemaVersion: CONTRACT_SCHEMA_VERSION,
          routes: [
            { path: "/ingress/events", upstream: config.ingressBaseUrl },
            { path: "/orchestration/plan", upstream: config.orchestratorBaseUrl },
            { path: "/test-harness/chat", upstream: "gateway-local" }
          ]
        });
        return true;
      }
      if (req.method === "POST" && req.url === "/test-harness/chat") {
        const incoming = harnessRequestSchema.parse(await readJsonBody(req));
        const ingressPayload = buildIngressSubmission({
          tenantId: incoming.tenantId,
          workspaceId: incoming.workspaceId,
          message: incoming.message,
          ...(incoming.actorPrincipalId ? { actorPrincipalId: incoming.actorPrincipalId } : {}),
          ...(incoming.actorPrincipalType ? { actorPrincipalType: incoming.actorPrincipalType } : {}),
          ...(incoming.channelPrincipalId ? { channelPrincipalId: incoming.channelPrincipalId } : {}),
          ...(incoming.channelMessageId ? { channelMessageId: incoming.channelMessageId } : {}),
          ...(incoming.sessionId ? { sessionId: incoming.sessionId } : {}),
          ...(incoming.conversationId ? { conversationId: incoming.conversationId } : {})
        });
        const ingressResponse = await fetch(`${config.ingressBaseUrl}/ingress/events`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${issueServiceToken(["service:api-gateway", "ingress.submit"])}`,
            "x-trace-id": trace.traceId,
            "x-correlation-id": trace.correlationId
          },
          body: JSON.stringify(ingressPayload)
        });
        if (!ingressResponse.ok) {
          respondJson(res, 502, {
            schemaVersion: CONTRACT_SCHEMA_VERSION,
            accepted: false,
            stage: "ingress_submission_failed",
            statusCode: ingressResponse.status,
            detail: await ingressResponse.text(),
            trace
          });
          return true;
        }

        const ingressBody = (await ingressResponse.json()) as {
          accepted: boolean;
          eventId: string;
          eventType: string;
        };
        logger.info("Harness message submitted to ingress", {
          eventId: ingressBody.eventId,
          traceId: trace.traceId,
          correlationId: trace.correlationId
        });

        try {
          const result = await pollForEventResult({
            eventId: ingressBody.eventId,
            orchestratorBaseUrl: config.orchestratorBaseUrl,
            authToken: issueServiceToken(["service:api-gateway", "orchestration.read"]),
            traceId: trace.traceId,
            correlationId: trace.correlationId,
            timeoutMs: config.harnessPollTimeoutMs,
            intervalMs: config.harnessPollIntervalMs
          });
          respondJson(res, result.status === "completed" ? 200 : result.status === "awaiting_approval" ? 202 : 502, {
            schemaVersion: CONTRACT_SCHEMA_VERSION,
            accepted: result.status === "completed",
            eventId: ingressBody.eventId,
            trace,
            result: result.result
          });
          return true;
        } catch (error) {
          respondJson(res, 504, {
            schemaVersion: CONTRACT_SCHEMA_VERSION,
            accepted: false,
            stage: "orchestrator_result_timeout",
            eventId: ingressBody.eventId,
            error: error instanceof Error ? error.message : "unknown",
            trace
          });
          return true;
        }
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
      service: "api-gateway",
      message: "Service bootstrap failed",
      error: error instanceof Error ? error.message : "unknown"
    })
  );
  process.exit(1);
});
