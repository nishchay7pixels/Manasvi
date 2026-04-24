import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

import {
  buildSpamKey,
  type AdapterParseResult,
  type IngressNormalizedMessage
} from "./channel-adapter.js";

const slackEventEnvelopeSchema = z.object({
  type: z.string().min(1),
  team_id: z.string().min(1).optional(),
  event_id: z.string().min(1).optional(),
  challenge: z.string().min(1).optional(),
  event: z
    .object({
      type: z.string().min(1),
      user: z.string().min(1).optional(),
      text: z.string().min(1).optional(),
      channel: z.string().min(1).optional(),
      ts: z.string().min(1).optional(),
      thread_ts: z.string().min(1).optional(),
      bot_id: z.string().min(1).optional(),
      subtype: z.string().min(1).optional()
    })
    .optional()
});

function readHeader(header: string | string[] | undefined): string | undefined {
  if (typeof header === "string") {
    return header;
  }
  if (Array.isArray(header) && header.length > 0) {
    return header[0];
  }
  return undefined;
}

export function verifySlackSignature(input: {
  rawBody: string;
  timestampHeader: string | string[] | undefined;
  signatureHeader: string | string[] | undefined;
  signingSecret: string | undefined;
}): { ok: boolean; reason?: string } {
  if (!input.signingSecret) {
    return { ok: false, reason: "SLACK_SIGNING_SECRET_NOT_CONFIGURED" };
  }
  const timestamp = readHeader(input.timestampHeader);
  const providedSignature = readHeader(input.signatureHeader);
  if (!timestamp || !providedSignature) {
    return { ok: false, reason: "SLACK_SIGNATURE_HEADERS_MISSING" };
  }
  if (!/^\d+$/.test(timestamp)) {
    return { ok: false, reason: "SLACK_SIGNATURE_TIMESTAMP_INVALID" };
  }
  const now = Math.floor(Date.now() / 1000);
  const ts = Number(timestamp);
  if (Math.abs(now - ts) > 300) {
    return { ok: false, reason: "SLACK_SIGNATURE_TIMESTAMP_OUT_OF_RANGE" };
  }
  const basestring = `v0:${timestamp}:${input.rawBody}`;
  const expected = `v0=${createHmac("sha256", input.signingSecret).update(basestring).digest("hex")}`;
  const left = Buffer.from(providedSignature, "utf8");
  const right = Buffer.from(expected, "utf8");
  if (left.length !== right.length || !timingSafeEqual(left, right)) {
    return { ok: false, reason: "SLACK_SIGNATURE_MISMATCH" };
  }
  return { ok: true };
}

export function parseSlackEvent(input: {
  body: unknown;
  serviceName: "ingress-service";
  signatureVerified: boolean;
  signatureFailureReason?: string;
}): AdapterParseResult | { challengeResponse: string } {
  const parsed = slackEventEnvelopeSchema.safeParse(input.body);
  if (!parsed.success) {
    return {
      ok: false,
      statusCode: 400,
      ignored: false,
      reason: "INVALID_SLACK_PAYLOAD"
    };
  }
  const payload = parsed.data;
  if (payload.type === "url_verification" && payload.challenge) {
    return { challengeResponse: payload.challenge };
  }
  if (payload.type !== "event_callback" || !payload.event) {
    return {
      ok: false,
      statusCode: 202,
      ignored: true,
      reason: "UNSUPPORTED_SLACK_EVENT_TYPE"
    };
  }
  if (!input.signatureVerified) {
    return {
      ok: false,
      statusCode: 401,
      ignored: false,
      reason: input.signatureFailureReason ?? "SLACK_SIGNATURE_INVALID"
    };
  }
  const event = payload.event;
  if (event.type !== "message" || !event.text || !event.channel || !event.ts || event.subtype || event.bot_id) {
    return {
      ok: false,
      statusCode: 202,
      ignored: true,
      reason: "UNSUPPORTED_SLACK_MESSAGE_EVENT"
    };
  }
  const actorPrincipalId = event.user ? `slack-user:${event.user}` : `slack-user:unknown`;
  const workspace = payload.team_id ?? "workspace-local";
  const normalized: IngressNormalizedMessage = {
    tenantId: "tenant-local",
    workspaceId: workspace,
    actor: {
      principalType: "human_user",
      principalId: actorPrincipalId
    },
    channel: {
      principalType: "channel",
      principalId: `slack-channel:${event.channel}`,
      messageId: `slack:${event.channel}:${event.ts}`
    },
    session: {
      conversationId: `slack-thread:${event.channel}:${event.thread_ts ?? event.ts}`,
      turnId: `slack-event:${payload.event_id ?? event.ts}`
    },
    text: event.text,
    metadata: {
      transport: "slack",
      slack: {
        channel: event.channel,
        timestamp: event.ts,
        ...(event.thread_ts ? { threadTs: event.thread_ts } : {})
      }
    },
    source: {
      sourceType: "channel",
      sourceId: "slack",
      sourceService: input.serviceName,
      authenticity: {
        verified: true,
        method: "signature",
        authnStrength: "strong",
        verificationTimestamp: new Date().toISOString(),
        credentialType: "hmac",
        trustNote: "Slack request signature verified."
      }
    },
    rateLimitKey: `slack:${event.channel}:${actorPrincipalId}`,
    spamKey: buildSpamKey(["slack", event.channel, actorPrincipalId, event.text.trim()]),
    replyTarget: {
      transport: "slack",
      channelId: event.channel,
      threadId: event.thread_ts ?? event.ts
    }
  };
  return { ok: true, normalized };
}
