import { z } from "zod";

import {
  buildSpamKey,
  sanitizeSessionHints,
  safeSecretEquals,
  type AdapterParseResult,
  type IngressNormalizedMessage
} from "./channel-adapter.js";

export const genericWebhookSchema = z.object({
  tenantId: z.string().min(1).default("tenant-local"),
  workspaceId: z.string().min(1).default("workspace-local"),
  sourceId: z.string().min(1).default("generic-webhook"),
  actor: z
    .object({
      principalId: z.string().min(1),
      principalType: z.enum(["human_user", "agent"]).default("human_user")
    })
    .optional(),
  channelId: z.string().min(1).default("channel:generic-webhook"),
  messageId: z.string().min(1).optional(),
  text: z.string().min(1),
  metadata: z.record(z.unknown()).default({}),
  session: z
    .object({
      sessionId: z.string().min(1).optional(),
      conversationId: z.string().min(1).optional(),
      turnId: z.string().min(1).optional()
    })
    .optional()
});

export function parseGenericWebhook(input: {
  body: unknown;
  sharedSecret: string | undefined;
  providedSecret: string | undefined;
  serviceName: "ingress-service";
}): AdapterParseResult {
  const parsed = genericWebhookSchema.safeParse(input.body);
  if (!parsed.success) {
    return {
      ok: false,
      statusCode: 400,
      ignored: false,
      reason: "INVALID_GENERIC_WEBHOOK_PAYLOAD"
    };
  }
  const incoming = parsed.data;
  const requiresSecret = Boolean(input.sharedSecret);
  const secretOk = input.sharedSecret ? safeSecretEquals(input.providedSecret, input.sharedSecret) : true;
  if (requiresSecret && !secretOk) {
    return {
      ok: false,
      statusCode: 401,
      ignored: false,
      reason: "GENERIC_WEBHOOK_SECRET_MISMATCH"
    };
  }
  const actor = incoming.actor ?? {
    principalId: `webhook-source:${incoming.sourceId}`,
    principalType: "agent" as const
  };
  const messageId = incoming.messageId ?? `generic:${Date.now()}`;
  const sessionHints = incoming.session
    ? sanitizeSessionHints({
        sessionId: incoming.session.sessionId,
        conversationId: incoming.session.conversationId,
        turnId: incoming.session.turnId
      })
    : undefined;
  const normalized: IngressNormalizedMessage = {
    tenantId: incoming.tenantId,
    workspaceId: incoming.workspaceId,
    actor: {
      principalId: actor.principalId,
      principalType: actor.principalType
    },
    channel: {
      principalType: "channel",
      principalId: incoming.channelId,
      messageId
    },
    ...(sessionHints ? { session: sessionHints } : {}),
    text: incoming.text,
    metadata: {
      transport: "generic-webhook",
      sourceId: incoming.sourceId,
      ...(incoming.metadata ?? {})
    },
    source: {
      sourceType: "api",
      sourceId: incoming.sourceId,
      sourceService: input.serviceName,
      authenticity: {
        verified: secretOk,
        method: secretOk && requiresSecret ? "signature" : "none",
        authnStrength: secretOk && requiresSecret ? "weak" : "none",
        verificationTimestamp: new Date().toISOString(),
        credentialType: requiresSecret ? "shared-secret" : "none",
        ...(secretOk && requiresSecret
          ? { trustNote: "Generic webhook shared secret validated." }
          : requiresSecret
            ? { failureReason: "shared_secret_mismatch" }
            : { trustNote: "Generic webhook accepted without configured secret." })
      }
    },
    rateLimitKey: `generic:${incoming.sourceId}:${incoming.channelId}`,
    spamKey: buildSpamKey(["generic", incoming.sourceId, incoming.channelId, incoming.text.trim()]),
    replyTarget: {
      transport: "generic-webhook"
    }
  };
  return { ok: true, normalized };
}
