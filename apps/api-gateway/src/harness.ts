import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

import { principalReferenceSchema } from "@manasvi/contracts";

export interface HarnessChatRequest {
  tenantId: string;
  workspaceId: string;
  message: string;
  actorPrincipalId?: string;
  actorPrincipalType?: "human_user" | "agent";
  channelPrincipalId?: string;
  channelMessageId?: string;
  sessionId?: string;
  conversationId?: string;
}

export interface IngressEventSubmission {
  tenantId: string;
  workspaceId: string;
  actor: {
    principalType: "human_user" | "agent";
    principalId: string;
  };
  channel: {
    principalType: "channel";
    principalId: string;
    messageId: string;
  };
  text: string;
  session?: {
    sessionId?: string;
    conversationId?: string;
    turnId?: string;
  };
  metadata: Record<string, unknown>;
}

export function buildIngressSubmission(input: HarnessChatRequest): IngressEventSubmission {
  const actor = principalReferenceSchema.parse({
    principalType: input.actorPrincipalType ?? "human_user",
    principalId: input.actorPrincipalId ?? "user:local-dev"
  });
  const channelPrincipal = principalReferenceSchema.parse({
    principalType: "channel",
    principalId: input.channelPrincipalId ?? "channel:local-dev"
  });
  return {
    tenantId: input.tenantId,
    workspaceId: input.workspaceId,
    actor: {
      principalType: actor.principalType as "human_user" | "agent",
      principalId: actor.principalId
    },
    channel: {
      principalType: "channel",
      principalId: channelPrincipal.principalId,
      messageId: input.channelMessageId ?? `msg:${randomUUID()}`
    },
    text: input.message,
    ...(input.sessionId || input.conversationId
      ? {
          session: {
            ...(input.sessionId ? { sessionId: input.sessionId } : {}),
            ...(input.conversationId ? { conversationId: input.conversationId } : {}),
            turnId: `turn:${randomUUID()}`
          }
        }
      : {}),
    metadata: {
      harness: true
    }
  };
}

export async function pollForEventResult(input: {
  eventId: string;
  orchestratorBaseUrl: string;
  authToken: string;
  traceId: string;
  correlationId: string;
  timeoutMs: number;
  intervalMs: number;
  fetchFn?: typeof fetch;
}): Promise<{
  status: "completed" | "failed" | "awaiting_approval";
  result: unknown;
}> {
  const started = Date.now();
  const fetcher = input.fetchFn ?? fetch;
  while (Date.now() - started < input.timeoutMs) {
    const response = await fetcher(
      `${input.orchestratorBaseUrl}/orchestration/event-results?eventId=${encodeURIComponent(input.eventId)}`,
      {
        method: "GET",
        headers: {
          authorization: `Bearer ${input.authToken}`,
          "x-trace-id": input.traceId,
          "x-correlation-id": input.correlationId
        }
      }
    );
    if (response.status === 404) {
      await delay(input.intervalMs);
      continue;
    }
    const body = (await response.json()) as { result?: unknown };
    if (response.status === 200) {
      return { status: "completed", result: body.result };
    }
    if (response.status === 202) {
      return { status: "awaiting_approval", result: body.result };
    }
    if (response.status >= 400) {
      return { status: "failed", result: body.result ?? body };
    }
  }
  throw new Error(
    `Timed out waiting for orchestrator event result for eventId=${input.eventId} after ${input.timeoutMs}ms`
  );
}
