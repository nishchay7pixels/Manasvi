import { z } from "zod";

import { principalReferenceSchema } from "@manasvi/contracts";
import { buildSpamKey, safeSecretEquals, type AdapterParseResult, type IngressNormalizedMessage } from "./channel-adapter.js";

export const telegramUpdateSchema = z.object({
  update_id: z.number().int(),
  message: z
    .object({
      message_id: z.number().int(),
      text: z.string().min(1).optional(),
      chat: z.object({
        id: z.union([z.number().int(), z.string().min(1)]),
        type: z.string().min(1),
        title: z.string().optional(),
        username: z.string().optional()
      }),
      from: z
        .object({
          id: z.union([z.number().int(), z.string().min(1)]),
          is_bot: z.boolean(),
          username: z.string().optional(),
          first_name: z.string().optional(),
          last_name: z.string().optional()
        })
        .optional()
    })
    .optional(),
  callback_query: z
    .object({
      id: z.string().min(1),
      data: z.string().min(1).optional(),
      from: z.object({
        id: z.union([z.number().int(), z.string().min(1)]),
        is_bot: z.boolean(),
        username: z.string().optional(),
        first_name: z.string().optional(),
        last_name: z.string().optional()
      }),
      message: z
        .object({
          message_id: z.number().int(),
          chat: z.object({
            id: z.union([z.number().int(), z.string().min(1)]),
            type: z.string().min(1),
            title: z.string().optional(),
            username: z.string().optional()
          })
        })
        .optional()
    })
    .optional()
});

export type TelegramUpdate = z.infer<typeof telegramUpdateSchema>;

export interface TelegramNormalizedMessage extends IngressNormalizedMessage {
  chatId: string;
}

export function normalizeTelegramUpdate(input: {
  update: unknown;
  tenantId: string;
  workspaceId: string;
}): TelegramNormalizedMessage | null {
  const parsed = telegramUpdateSchema.safeParse(input.update);
  if (!parsed.success) {
    return null;
  }
  const message = parsed.data.message;
  const callbackQuery = parsed.data.callback_query;
  const callbackMessage = callbackQuery?.message;
  const callbackData = callbackQuery?.data?.trim();
  const hasTextMessage = Boolean(message?.text && message.text.trim().length > 0);
  const hasCallbackData = Boolean(callbackData && callbackMessage);
  if (!hasTextMessage && !hasCallbackData) {
    return null;
  }
  const normalizedText = hasTextMessage ? message?.text?.trim() ?? "" : callbackData ?? "";
  const isCallback = !hasTextMessage && hasCallbackData;
  const chatId = String(isCallback ? callbackMessage?.chat.id : message?.chat.id);
  const sender = isCallback ? callbackQuery?.from : message?.from;
  const fromId = String(sender?.id ?? `chat:${chatId}`);
  const actorType: "human_user" | "agent" = sender?.is_bot ? "agent" : "human_user";
  const displayName =
    [sender?.first_name, sender?.last_name].filter((value) => Boolean(value && value.length > 0)).join(" ") ||
    sender?.username;
  const actor = principalReferenceSchema.parse({
    principalType: actorType,
    principalId: `telegram-user:${fromId}`,
    ...(displayName ? { displayName } : {})
  });
  const channel = principalReferenceSchema.parse({
    principalType: "channel",
    principalId: `telegram-chat:${chatId}`,
    ...((isCallback ? callbackMessage?.chat.title : message?.chat.title)
      ? { displayName: isCallback ? callbackMessage?.chat.title : message?.chat.title }
      : {})
  });
  const telegramMetadata: Record<string, unknown> = {
    updateId: parsed.data.update_id,
    chatType: isCallback ? callbackMessage?.chat.type : message?.chat.type
  };
  if ((isCallback ? callbackMessage?.chat.username : message?.chat.username)) {
    telegramMetadata.chatUsername = isCallback ? callbackMessage?.chat.username : message?.chat.username;
  }
  if (sender?.username) {
    telegramMetadata.senderUsername = sender.username;
  }
  if (isCallback && callbackQuery?.id) {
    telegramMetadata.callbackQueryId = callbackQuery.id;
  }
  return {
    tenantId: input.tenantId,
    workspaceId: input.workspaceId,
    actor: {
      principalType: actor.principalType as "human_user" | "agent",
      principalId: actor.principalId
    },
    channel: {
      principalType: "channel",
      principalId: channel.principalId,
      messageId: `telegram:${chatId}:${isCallback ? callbackMessage?.message_id : message?.message_id}`
    },
    session: {
      conversationId: `telegram-chat:${chatId}`,
      turnId: `telegram-update:${parsed.data.update_id}`
    },
    text: normalizedText,
    metadata: {
      transport: "telegram",
      telegram: telegramMetadata
    },
    source: {
      sourceType: "channel",
      sourceId: "telegram",
      sourceService: "ingress-service",
      authenticity: {
        verified: true,
        method: "token",
        authnStrength: "weak",
        verificationTimestamp: new Date().toISOString(),
        credentialType: "shared-secret",
        trustNote: "Telegram webhook ingress path accepted."
      }
    },
    rateLimitKey: `telegram:${chatId}:${fromId}`,
    spamKey: buildSpamKey(["telegram", chatId, fromId, normalizedText]),
    replyTarget: {
      transport: "telegram",
      chatId
    },
    chatId
  };
}

export function parseTelegramWebhook(input: {
  body: unknown;
  tenantId: string;
  workspaceId: string;
  webhookSecret: string | undefined;
  providedSecretHeader: string | string[] | undefined;
}): AdapterParseResult {
  if (input.webhookSecret) {
    const providedSecret =
      typeof input.providedSecretHeader === "string"
        ? input.providedSecretHeader
        : Array.isArray(input.providedSecretHeader)
          ? input.providedSecretHeader[0]
          : undefined;
    if (!safeSecretEquals(providedSecret, input.webhookSecret)) {
      return {
        ok: false,
        statusCode: 401,
        ignored: false,
        reason: "TELEGRAM_WEBHOOK_SECRET_MISMATCH"
      };
    }
  }
  const normalized = normalizeTelegramUpdate({
    update: input.body,
    tenantId: input.tenantId,
    workspaceId: input.workspaceId
  });
  if (!normalized) {
    return {
      ok: false,
      statusCode: 200,
      ignored: true,
      reason: "unsupported_or_non_text_update"
    };
  }
  normalized.source.authenticity = {
    ...normalized.source.authenticity,
    ...(input.webhookSecret
      ? {
          verified: true,
          method: "token",
          authnStrength: "strong",
          trustNote: "Telegram webhook secret token validated."
        }
      : {
          verified: false,
          method: "none",
          authnStrength: "none",
          failureReason: "telegram_webhook_secret_not_configured",
          trustNote: "Telegram webhook accepted without secret validation."
        })
  };
  return { ok: true, normalized };
}

export function extractResponseTextFromOrchestratorResult(input: unknown): string {
  const parsed = z
    .object({
      status: z.string().optional(),
      responseText: z.string().min(1).optional(),
      outcome: z
        .object({
          responseText: z.string().min(1).optional(),
          status: z.string().optional(),
          reasonCode: z.string().optional()
        })
        .optional()
    })
    .safeParse(input);
  if (!parsed.success) {
    return "Request processed, but no response text was available.";
  }
  const status = parsed.data.status ?? parsed.data.outcome?.status;
  if (parsed.data.responseText) {
    return sanitizeUserFacingResponse(parsed.data.responseText, status);
  }
  if (parsed.data.outcome?.responseText) {
    return sanitizeUserFacingResponse(parsed.data.outcome.responseText, status);
  }
  return "Request processed, but no response text was available.";
}

function sanitizeUserFacingResponse(text: string, status?: string): string {
  const trimmed = text.trim();
  const candidate = extractJsonObject(trimmed);
  if (!candidate) return text;
  try {
    const parsed = JSON.parse(candidate) as { decisionType?: string; responseText?: string };
    if (parsed.decisionType === "action_proposal") {
      return status === "awaiting_approval"
        ? "This action needs approval. Reply yes to proceed or no to cancel."
        : "I could not confirm completion for that action. Please retry the request.";
    }
    if (parsed.decisionType === "final_response" && typeof parsed.responseText === "string" && parsed.responseText.trim().length > 0) {
      return parsed.responseText;
    }
  } catch {
    return text;
  }
  return text;
}

function extractJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const ch = text[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === "\"") {
        inString = false;
      }
      continue;
    }
    if (ch === "\"") {
      inString = true;
      continue;
    }
    if (ch === "{") {
      depth += 1;
      continue;
    }
    if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, index + 1);
      }
    }
  }
  return null;
}
