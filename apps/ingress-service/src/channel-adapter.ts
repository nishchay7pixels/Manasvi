import { createHash, timingSafeEqual } from "node:crypto";

import type { sourceSchema } from "@manasvi/contracts";
import type { z } from "zod";

export type SourceType = z.infer<typeof sourceSchema>["sourceType"];

export interface AdapterAuthResult {
  verified: boolean;
  method: "none" | "signature" | "token" | "mTLS" | "internal-auth";
  authnStrength: "none" | "weak" | "strong";
  evidenceRef?: string;
  verificationTimestamp: string;
  credentialType?: "shared-secret" | "jwt" | "hmac" | "oauth-token" | "web-session" | "none";
  failureReason?: string;
  trustNote?: string;
}

export interface IngressNormalizedMessage {
  tenantId: string;
  workspaceId: string;
  actor: {
    principalType: "human_user" | "agent" | "service" | "channel" | "plugin" | "execution_node";
    principalId: string;
  };
  channel: {
    principalType: "channel";
    principalId: string;
    messageId: string;
  };
  session?: {
    sessionId?: string;
    conversationId?: string;
    turnId?: string;
  };
  text: string;
  metadata: Record<string, unknown>;
  source: {
    sourceType: SourceType;
    sourceId: string;
    sourceService?: z.infer<typeof sourceSchema>["sourceService"];
    authenticity: AdapterAuthResult;
  };
  rateLimitKey: string;
  spamKey: string;
  replyTarget?: {
    transport: "telegram" | "slack" | "webui" | "generic-webhook";
    chatId?: string;
    channelId?: string;
    threadId?: string;
  };
}

export function sanitizeSessionHints(input: {
  sessionId: string | undefined;
  conversationId: string | undefined;
  turnId: string | undefined;
}): IngressNormalizedMessage["session"] | undefined {
  const value: Record<string, string> = {};
  if (input.sessionId) {
    value.sessionId = input.sessionId;
  }
  if (input.conversationId) {
    value.conversationId = input.conversationId;
  }
  if (input.turnId) {
    value.turnId = input.turnId;
  }
  return Object.keys(value).length > 0 ? value : undefined;
}

export interface AdapterParseSuccess {
  ok: true;
  normalized: IngressNormalizedMessage;
}

export interface AdapterParseIgnored {
  ok: false;
  statusCode: 200 | 202 | 400 | 401 | 403;
  reason: string;
  ignored: boolean;
}

export type AdapterParseResult = AdapterParseSuccess | AdapterParseIgnored;

export function buildSpamKey(parts: ReadonlyArray<string>): string {
  return createHash("sha256").update(parts.join("::")).digest("hex");
}

export function safeSecretEquals(provided: string | undefined, expected: string): boolean {
  if (!provided) {
    return false;
  }
  const left = Buffer.from(provided, "utf8");
  const right = Buffer.from(expected, "utf8");
  if (left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(left, right);
}
