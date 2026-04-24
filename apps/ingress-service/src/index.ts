import { IncomingMessage } from "node:http";
import { z } from "zod";

import {
  CONTRACT_SCHEMA_VERSION,
  createCanonicalEvent,
  parseCanonicalEvent
} from "@manasvi/contracts";
import {
  InternalTokenService,
  PrincipalResolver,
  buildServicePrincipalReference
} from "@manasvi/auth";
import { EventPublisher, HttpTransport } from "@manasvi/event-bus";
import { respondJson, startHttpService } from "@manasvi/service-runtime";

import { type IngressNormalizedMessage } from "./channel-adapter.js";
import { loadIngressServiceConfig } from "./config.js";
import { InMemoryDuplicateGuard, InMemoryRateLimiter } from "./edge-controls.js";
import { extractResponseTextFromOrchestratorResult, parseTelegramWebhook } from "./telegram-adapter.js";
import { parseWebUiMessage, parseLegacyIngressEvent } from "./webui-adapter.js";
import { parseGenericWebhook } from "./generic-webhook-adapter.js";
import { parseSlackEvent, verifySlackSignature } from "./slack-adapter.js";

async function readRawRequestBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    req.on("end", () => {
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
    req.on("error", reject);
  });
}

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
  const rateLimiter = new InMemoryRateLimiter(config.ingressRateLimitMaxPerSource, config.ingressRateLimitWindowMs);
  const duplicateGuard = new InMemoryDuplicateGuard(config.ingressAntiSpamDuplicateTtlMs);

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

  const telegramWebhookEnvelopeSchema = z.object({
    tenantId: z.string().min(1).default("tenant-local"),
    workspaceId: z.string().min(1).default("workspace-local"),
    update: z.unknown().optional()
  });

  const issueOrchestrationReadToken = (): string =>
    tokenService.issueToken({
      caller: servicePrincipal,
      scopes: ["service:ingress", "orchestration.read"]
    });

  async function pollForOrchestratorResult(input: {
    eventId: string;
    traceId: string;
    correlationId: string;
  }): Promise<unknown | null> {
    const started = Date.now();
    const authToken = issueOrchestrationReadToken();
    while (Date.now() - started < config.replyPollTimeoutMs) {
      const response = await fetch(
        `${config.orchestratorBaseUrl.replace(/\/$/, "")}/orchestration/event-results?eventId=${encodeURIComponent(input.eventId)}`,
        {
          method: "GET",
          headers: {
            authorization: `Bearer ${authToken}`,
            "x-trace-id": input.traceId,
            "x-correlation-id": input.correlationId
          }
        }
      );
      if (response.status === 404) {
        await new Promise((resolve) => setTimeout(resolve, config.replyPollIntervalMs));
        continue;
      }
      const body = (await response.json()) as { result?: unknown };
      if (response.ok) {
        return body.result ?? null;
      }
      return null;
    }
    return null;
  }

  async function sendTelegramMessage(input: {
    chatId: string;
    text: string;
  }): Promise<void> {
    if (!config.telegramBotToken) {
      return;
    }
    await fetch(`${config.telegramApiBaseUrl.replace(/\/$/, "")}/bot${config.telegramBotToken}/sendMessage`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        chat_id: input.chatId,
        text: input.text
      })
    });
  }

  async function sendSlackMessage(input: {
    channelId: string;
    text: string;
    threadId?: string;
  }): Promise<void> {
    if (!config.slackBotToken) {
      return;
    }
    await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${config.slackBotToken}`
      },
      body: JSON.stringify({
        channel: input.channelId,
        text: input.text,
        ...(input.threadId ? { thread_ts: input.threadId } : {})
      })
    });
  }

  async function publishNormalizedInboundEvent(input: {
    normalized: IngressNormalizedMessage;
    trace: { traceId: string; correlationId: string; parentTraceId?: string };
  }) {
    const normalizedEvent = createCanonicalEvent({
      eventType: "ingress.external_message.received",
      tenantId: input.normalized.tenantId,
      workspaceId: input.normalized.workspaceId,
      actor: input.normalized.actor,
      channel: {
        principalType: input.normalized.channel.principalType,
        principalId: input.normalized.channel.principalId
      },
      source: {
        sourceType: input.normalized.source.sourceType,
        sourceId: input.normalized.source.sourceId,
        ...(input.normalized.source.sourceService ? { sourceService: input.normalized.source.sourceService } : {}),
        sourceAuthenticity: input.normalized.source.authenticity
      },
      trace: input.trace,
      ...(input.normalized.session ? { session: input.normalized.session } : {}),
      payload: {
        payloadSchemaVersion: "1.0",
        channelMessageId: input.normalized.channel.messageId,
        text: input.normalized.text,
        metadata: {
          ...input.normalized.metadata,
          ingress: {
            rawInboundTrust: "untrusted",
            adapterCompromiseBoundary:
              "ingress adapters cannot execute tools; ingress only normalizes and publishes events"
          }
        }
      },
      trustClassification: "EXTERNAL_UNTRUSTED",
      risk: {
        level: "medium",
        reasons: ["external_channel_input"]
      },
      idempotencyKey: `ingress:${input.normalized.channel.principalId}:${input.normalized.channel.messageId}`,
      producer: {
        serviceName: "ingress-service",
        serviceVersion: config.serviceVersion,
        environment: config.environment
      }
    });
    const validated = parseCanonicalEvent(normalizedEvent);
    await publisher.publish(validated);
    return validated;
  }

  function evaluateEdgeControls(message: IngressNormalizedMessage): {
    ok: true;
  } | {
    ok: false;
    statusCode: number;
    reason: string;
    retryAfterMs?: number;
  } {
    const rate = rateLimiter.evaluate(message.rateLimitKey);
    if (!rate.allowed) {
      return {
        ok: false,
        statusCode: 429,
        reason: "RATE_LIMITED",
        retryAfterMs: rate.retryAfterMs
      };
    }
    const unique = duplicateGuard.markOrReject(message.spamKey);
    if (!unique) {
      return {
        ok: false,
        statusCode: 202,
        reason: "DUPLICATE_SUPPRESSED"
      };
    }
    return { ok: true };
  }

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
      if (req.method === "GET" && req.url === "/ingress/adapters") {
        respondJson(res, 200, {
          schemaVersion: CONTRACT_SCHEMA_VERSION,
          adapters: [
            {
              adapterId: "webui-api",
              transport: "http",
              inboundPath: "/ingress/webui/messages",
              outboundMode: "sync_http_response",
              authenticity: "internal auth token",
              status: "enabled"
            },
            {
              adapterId: "legacy-ingress-events",
              transport: "http",
              inboundPath: "/ingress/events",
              outboundMode: "none",
              authenticity: "internal auth token (recommended)",
              status: "enabled"
            },
            {
              adapterId: "telegram-webhook",
              transport: "telegram",
              inboundPath: "/ingress/telegram/webhook",
              outboundMode: "telegram-sendMessage",
              authenticity: "telegram webhook secret token",
              status: config.telegramBotToken ? "enabled" : "disabled"
            },
            {
              adapterId: "slack-events",
              transport: "slack",
              inboundPath: "/ingress/slack/events",
              outboundMode: "slack-chat.postMessage",
              authenticity: "slack request signature",
              status: config.slackSigningSecret ? "enabled" : "scaffolded"
            },
            {
              adapterId: "generic-webhook",
              transport: "http",
              inboundPath: "/ingress/webhook/generic",
              outboundMode: "none",
              authenticity: "optional shared secret",
              status: "enabled"
            }
          ]
        });
        return true;
      }
      if (req.method === "POST" && req.url === "/ingress/events") {
        const rawBody = await readRawRequestBody(req);
        const payload = JSON.parse(rawBody);
        const resolved = resolver.resolveFromHttpHeaders(req.headers, {
          requireAuthentication: config.channelSignatureRequired,
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
        const parsed = parseLegacyIngressEvent({
          body: payload,
          authenticated: Boolean(resolved.context?.authenticated),
          serviceName: config.serviceName
        });
        if (!parsed.ok) {
          respondJson(res, parsed.statusCode, {
            schemaVersion: CONTRACT_SCHEMA_VERSION,
            accepted: false,
            reason: parsed.reason,
            ignored: parsed.ignored
          });
          return true;
        }
        const edge = evaluateEdgeControls(parsed.normalized);
        if (!edge.ok) {
          logger.warn("Ingress edge control rejected legacy ingress event", {
            reason: edge.reason,
            rateLimitKey: parsed.normalized.rateLimitKey,
            traceId: trace.traceId
          });
          respondJson(res, edge.statusCode, {
            schemaVersion: CONTRACT_SCHEMA_VERSION,
            accepted: false,
            reason: edge.reason,
            ...(edge.retryAfterMs ? { retryAfterMs: edge.retryAfterMs } : {})
          });
          return true;
        }
        const validated = await publishNormalizedInboundEvent({
          normalized: parsed.normalized,
          trace
        });
        logger.info("Published normalized ingress event", {
          eventId: validated.eventId,
          eventType: validated.eventType,
          actorPrincipalId: validated.actor.principalId,
          channelPrincipalId: validated.channel.principalId,
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
      if (req.method === "POST" && req.url === "/ingress/webui/messages") {
        const rawBody = await readRawRequestBody(req);
        const payload = JSON.parse(rawBody);
        const resolved = resolver.resolveFromHttpHeaders(req.headers, {
          requireAuthentication: config.webUiAdapterRequireAuth,
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
        const parsed = parseWebUiMessage({
          body: payload,
          authenticated: Boolean(resolved.context?.authenticated),
          serviceName: config.serviceName,
          traceId: trace.traceId,
          correlationId: trace.correlationId
        });
        if (!parsed.ok) {
          respondJson(res, parsed.statusCode, {
            schemaVersion: CONTRACT_SCHEMA_VERSION,
            accepted: false,
            reason: parsed.reason,
            ignored: parsed.ignored
          });
          return true;
        }
        const edge = evaluateEdgeControls(parsed.normalized);
        if (!edge.ok) {
          respondJson(res, edge.statusCode, {
            schemaVersion: CONTRACT_SCHEMA_VERSION,
            accepted: false,
            reason: edge.reason,
            ...(edge.retryAfterMs ? { retryAfterMs: edge.retryAfterMs } : {})
          });
          return true;
        }
        const event = await publishNormalizedInboundEvent({
          normalized: parsed.normalized,
          trace
        });
        const orchestratorResult = await pollForOrchestratorResult({
          eventId: event.eventId,
          traceId: trace.traceId,
          correlationId: trace.correlationId
        });
        respondJson(res, orchestratorResult ? 200 : 504, {
          schemaVersion: CONTRACT_SCHEMA_VERSION,
          accepted: Boolean(orchestratorResult),
          eventId: event.eventId,
          trace,
          ...(orchestratorResult
            ? {
                result: orchestratorResult,
                responseText: extractResponseTextFromOrchestratorResult(orchestratorResult)
              }
            : {
                error: "ORCHESTRATOR_RESPONSE_TIMEOUT"
              })
        });
        return true;
      }
      if (req.method === "POST" && req.url === "/ingress/telegram/webhook") {
        if (!config.telegramBotToken) {
          respondJson(res, 503, {
            schemaVersion: CONTRACT_SCHEMA_VERSION,
            accepted: false,
            error: "TELEGRAM_NOT_CONFIGURED"
          });
          return true;
        }
        const rawBody = await readRawRequestBody(req);
        const parsedEnvelope = telegramWebhookEnvelopeSchema.safeParse(JSON.parse(rawBody));
        const payloadUpdate = parsedEnvelope.success && parsedEnvelope.data.update
          ? parsedEnvelope.data.update
          : JSON.parse(rawBody);
        const parsed = parseTelegramWebhook({
          body: payloadUpdate,
          tenantId: parsedEnvelope.success ? parsedEnvelope.data.tenantId : "tenant-local",
          workspaceId: parsedEnvelope.success ? parsedEnvelope.data.workspaceId : "workspace-local",
          webhookSecret: config.telegramWebhookSecret,
          providedSecretHeader: req.headers["x-telegram-bot-api-secret-token"]
        });
        if (!parsed.ok) {
          respondJson(res, parsed.statusCode, {
            schemaVersion: CONTRACT_SCHEMA_VERSION,
            accepted: parsed.ignored,
            ignored: parsed.ignored,
            reason: parsed.reason
          });
          return true;
        }
        const edge = evaluateEdgeControls(parsed.normalized);
        if (!edge.ok) {
          respondJson(res, edge.statusCode, {
            schemaVersion: CONTRACT_SCHEMA_VERSION,
            accepted: false,
            reason: edge.reason,
            ...(edge.retryAfterMs ? { retryAfterMs: edge.retryAfterMs } : {})
          });
          return true;
        }
        const event = await publishNormalizedInboundEvent({
          normalized: parsed.normalized,
          trace
        });
        const orchestratorResult = await pollForOrchestratorResult({
          eventId: event.eventId,
          traceId: trace.traceId,
          correlationId: trace.correlationId
        });
        const replyText = orchestratorResult
          ? extractResponseTextFromOrchestratorResult(orchestratorResult)
          : "I received your message, but I could not produce a response in time.";
        if (parsed.normalized.replyTarget?.chatId) {
          await sendTelegramMessage({
            chatId: parsed.normalized.replyTarget.chatId,
            text: replyText
          });
        }
        logger.info("Processed telegram webhook update", {
          eventId: event.eventId,
          chatId: parsed.normalized.replyTarget?.chatId,
          actorPrincipalId: parsed.normalized.actor.principalId,
          traceId: trace.traceId,
          correlationId: trace.correlationId
        });
        respondJson(res, 200, {
          schemaVersion: CONTRACT_SCHEMA_VERSION,
          accepted: true,
          eventId: event.eventId,
          trace
        });
        return true;
      }
      if (req.method === "POST" && req.url === "/ingress/slack/events") {
        const rawBody = await readRawRequestBody(req);
        const signature = verifySlackSignature({
          rawBody,
          timestampHeader: req.headers["x-slack-request-timestamp"],
          signatureHeader: req.headers["x-slack-signature"],
          signingSecret: config.slackSigningSecret
        });
        let payload: unknown = {};
        try {
          payload = JSON.parse(rawBody);
        } catch {
          respondJson(res, 400, {
            schemaVersion: CONTRACT_SCHEMA_VERSION,
            accepted: false,
            reason: "INVALID_SLACK_JSON"
          });
          return true;
        }
        const parsed = parseSlackEvent({
          body: payload,
          serviceName: config.serviceName,
          signatureVerified: signature.ok,
          ...(signature.reason ? { signatureFailureReason: signature.reason } : {})
        });
        if ("challengeResponse" in parsed) {
          respondJson(res, 200, {
            challenge: parsed.challengeResponse
          });
          return true;
        }
        if (!parsed.ok) {
          respondJson(res, parsed.statusCode, {
            schemaVersion: CONTRACT_SCHEMA_VERSION,
            accepted: parsed.ignored,
            ignored: parsed.ignored,
            reason: parsed.reason
          });
          return true;
        }
        const edge = evaluateEdgeControls(parsed.normalized);
        if (!edge.ok) {
          respondJson(res, edge.statusCode, {
            schemaVersion: CONTRACT_SCHEMA_VERSION,
            accepted: false,
            reason: edge.reason
          });
          return true;
        }
        const event = await publishNormalizedInboundEvent({
          normalized: parsed.normalized,
          trace
        });
        const orchestratorResult = await pollForOrchestratorResult({
          eventId: event.eventId,
          traceId: trace.traceId,
          correlationId: trace.correlationId
        });
        if (orchestratorResult && parsed.normalized.replyTarget?.channelId) {
          await sendSlackMessage({
            channelId: parsed.normalized.replyTarget.channelId,
            text: extractResponseTextFromOrchestratorResult(orchestratorResult),
            ...(parsed.normalized.replyTarget.threadId ? { threadId: parsed.normalized.replyTarget.threadId } : {})
          });
        }
        respondJson(res, 200, {
          schemaVersion: CONTRACT_SCHEMA_VERSION,
          accepted: true,
          eventId: event.eventId,
          trace
        });
        return true;
      }
      if (req.method === "POST" && req.url === "/ingress/webhook/generic") {
        const rawBody = await readRawRequestBody(req);
        let payload: unknown = {};
        try {
          payload = JSON.parse(rawBody);
        } catch {
          respondJson(res, 400, {
            schemaVersion: CONTRACT_SCHEMA_VERSION,
            accepted: false,
            reason: "INVALID_GENERIC_WEBHOOK_JSON"
          });
          return true;
        }
        const providedSecret = typeof req.headers["x-manasvi-webhook-secret"] === "string"
          ? req.headers["x-manasvi-webhook-secret"]
          : Array.isArray(req.headers["x-manasvi-webhook-secret"])
            ? req.headers["x-manasvi-webhook-secret"][0]
            : undefined;
        const parsed = parseGenericWebhook({
          body: payload,
          sharedSecret: config.genericWebhookSharedSecret,
          providedSecret,
          serviceName: config.serviceName
        });
        if (!parsed.ok) {
          respondJson(res, parsed.statusCode, {
            schemaVersion: CONTRACT_SCHEMA_VERSION,
            accepted: false,
            reason: parsed.reason
          });
          return true;
        }
        const edge = evaluateEdgeControls(parsed.normalized);
        if (!edge.ok) {
          respondJson(res, edge.statusCode, {
            schemaVersion: CONTRACT_SCHEMA_VERSION,
            accepted: false,
            reason: edge.reason
          });
          return true;
        }
        const event = await publishNormalizedInboundEvent({
          normalized: parsed.normalized,
          trace
        });
        respondJson(res, 202, {
          schemaVersion: CONTRACT_SCHEMA_VERSION,
          accepted: true,
          eventId: event.eventId,
          trace
        });
        return true;
      }
      if (req.method === "POST" && req.url === "/ingress/telegram/set-webhook") {
        if (!config.telegramBotToken) {
          respondJson(res, 503, {
            schemaVersion: CONTRACT_SCHEMA_VERSION,
            accepted: false,
            error: "TELEGRAM_NOT_CONFIGURED"
          });
          return true;
        }
        const principal = resolver.resolveFromHttpHeaders(req.headers, {
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
        const rawBody = await readRawRequestBody(req);
        const body = z.object({
          webhookUrl: z.string().url()
        }).parse(JSON.parse(rawBody));
        const response = await fetch(`${config.telegramApiBaseUrl.replace(/\/$/, "")}/bot${config.telegramBotToken}/setWebhook`, {
          method: "POST",
          headers: {
            "content-type": "application/json"
          },
          body: JSON.stringify({
            url: body.webhookUrl,
            ...(config.telegramWebhookSecret ? { secret_token: config.telegramWebhookSecret } : {})
          })
        });
        const payload = await response.json();
        respondJson(res, response.ok ? 200 : 502, {
          schemaVersion: CONTRACT_SCHEMA_VERSION,
          accepted: response.ok,
          telegramResponse: payload
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
