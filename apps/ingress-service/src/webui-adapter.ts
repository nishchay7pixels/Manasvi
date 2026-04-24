import { z } from "zod";

import {
  buildSpamKey,
  sanitizeSessionHints,
  type AdapterParseResult,
  type IngressNormalizedMessage
} from "./channel-adapter.js";

export const webUiMessageSchema = z.object({
  tenantId: z.string().min(1),
  workspaceId: z.string().min(1),
  actorPrincipalId: z.string().min(1),
  actorPrincipalType: z.enum(["human_user", "agent"]).default("human_user"),
  channelPrincipalId: z.string().min(1).default("channel:webui"),
  channelMessageId: z.string().min(1).optional(),
  sessionId: z.string().min(1).optional(),
  conversationId: z.string().min(1).optional(),
  turnId: z.string().min(1).optional(),
  message: z.string().min(1),
  metadata: z.record(z.unknown()).default({})
});

export const legacyIngressEventSchema = z.object({
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

export function parseWebUiMessage(input: {
  body: unknown;
  authenticated: boolean;
  serviceName: "ingress-service";
  traceId: string;
  correlationId: string;
}): AdapterParseResult {
  const parsed = webUiMessageSchema.safeParse(input.body);
  if (!parsed.success) {
    return {
      ok: false,
      statusCode: 400,
      ignored: false,
      reason: "INVALID_WEBUI_PAYLOAD"
    };
  }
  const message = parsed.data;
  const messageId = message.channelMessageId ?? `webui:${Date.now()}`;
  const sessionHints = sanitizeSessionHints({
    sessionId: message.sessionId,
    conversationId: message.conversationId,
    turnId: message.turnId
  });
  const normalized: IngressNormalizedMessage = {
    tenantId: message.tenantId,
    workspaceId: message.workspaceId,
    actor: {
      principalType: message.actorPrincipalType,
      principalId: message.actorPrincipalId
    },
    channel: {
      principalType: "channel",
      principalId: message.channelPrincipalId,
      messageId
    },
    ...(sessionHints ? { session: sessionHints } : {}),
    text: message.message,
    metadata: {
      transport: "webui",
      ...(message.metadata ?? {})
    },
    source: {
      sourceType: "api",
      sourceId: "webui-api",
      sourceService: input.serviceName,
      authenticity: {
        verified: input.authenticated,
        method: input.authenticated ? "internal-auth" : "none",
        authnStrength: input.authenticated ? "strong" : "none",
        verificationTimestamp: new Date().toISOString(),
        credentialType: input.authenticated ? "jwt" : "none",
        evidenceRef: input.authenticated ? "internal-token" : "anonymous-webui",
        ...(input.authenticated
          ? { trustNote: "Authenticated first-party Web UI/API request." }
          : { failureReason: "missing_or_invalid_auth_token" })
      }
    },
    rateLimitKey: `webui:${message.channelPrincipalId}:${message.actorPrincipalId}`,
    spamKey: buildSpamKey(["webui", message.channelPrincipalId, message.actorPrincipalId, message.message.trim()]),
    replyTarget: {
      transport: "webui"
    }
  };
  return { ok: true, normalized };
}

export function parseLegacyIngressEvent(input: {
  body: unknown;
  authenticated: boolean;
  serviceName: "ingress-service";
}): AdapterParseResult {
  const parsed = legacyIngressEventSchema.safeParse(input.body);
  if (!parsed.success) {
    return {
      ok: false,
      statusCode: 400,
      ignored: false,
      reason: "INVALID_INGRESS_EVENT_PAYLOAD"
    };
  }
  const message = parsed.data;
  const sessionHints = message.session
    ? sanitizeSessionHints({
        sessionId: message.session.sessionId,
        conversationId: message.session.conversationId,
        turnId: message.session.turnId
      })
    : undefined;
  const normalized: IngressNormalizedMessage = {
    tenantId: message.tenantId,
    workspaceId: message.workspaceId,
    actor: message.actor,
    channel: message.channel,
    ...(sessionHints ? { session: sessionHints } : {}),
    text: message.text,
    metadata: message.metadata,
    source: {
      sourceType: input.authenticated ? "service" : "api",
      sourceId: input.authenticated ? input.serviceName : message.channel.principalId,
      ...(input.authenticated ? { sourceService: input.serviceName } : {}),
      authenticity: {
        verified: input.authenticated,
        method: input.authenticated ? "internal-auth" : "none",
        authnStrength: input.authenticated ? "strong" : "none",
        verificationTimestamp: new Date().toISOString(),
        credentialType: input.authenticated ? "jwt" : "none",
        evidenceRef: input.authenticated ? "internal-token" : "anonymous-ingress",
        ...(input.authenticated
          ? { trustNote: "Authenticated internal ingress publish request." }
          : { failureReason: "missing_or_invalid_auth_token" })
      }
    },
    rateLimitKey: `legacy:${message.channel.principalId}`,
    spamKey: buildSpamKey(["legacy", message.channel.principalId, message.channel.messageId, message.text.trim()])
  };
  return { ok: true, normalized };
}
