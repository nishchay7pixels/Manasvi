import { createHmac, createHash, randomUUID } from "node:crypto";
import { z } from "zod";

import {
  EVENT_ENVELOPE_VERSION,
  serviceNameSchema,
  trustClassSchema,
  type TrustClass
} from "./base.js";
import { principalReferenceSchema } from "./identity.js";

export const eventEnvelopeVersionSchema = z.literal(EVENT_ENVELOPE_VERSION);

export const eventCategorySchema = z.enum([
  "ingress",
  "approval",
  "tooling",
  "service",
  "policy",
  "execution_intent"
]);
export type EventCategory = z.infer<typeof eventCategorySchema>;

export const eventTypeSchema = z.enum([
  "ingress.external_message.received",
  "approval.decision.recorded",
  "tool.execution.result",
  "service.lifecycle.status",
  "policy.evaluation.requested",
  "policy.evaluation.responded",
  "execution.intent.created"
]);
export type EventType = z.infer<typeof eventTypeSchema>;

export const eventTypeCategoryMap: Record<EventType, EventCategory> = {
  "ingress.external_message.received": "ingress",
  "approval.decision.recorded": "approval",
  "tool.execution.result": "tooling",
  "service.lifecycle.status": "service",
  "policy.evaluation.requested": "policy",
  "policy.evaluation.responded": "policy",
  "execution.intent.created": "execution_intent"
};

export const authenticitySchema = z.object({
  verified: z.boolean(),
  method: z.enum(["none", "signature", "token", "mTLS", "internal-auth"]),
  authnStrength: z.enum(["none", "weak", "strong"]),
  evidenceRef: z.string().min(1).optional()
});

export const sourceSchema = z.object({
  sourceType: z.enum(["channel", "api", "service", "plugin", "node"]),
  sourceId: z.string().min(1),
  sourceService: serviceNameSchema.optional(),
  sourceAuthenticity: authenticitySchema
});

export const attachmentSchema = z.object({
  attachmentId: z.string().min(1),
  mediaType: z.string().min(1),
  contentRef: z.string().min(1),
  sizeBytes: z.number().int().nonnegative(),
  scanStatus: z.enum(["pending", "clean", "blocked"]).default("pending")
});

export const riskMetadataSchema = z.object({
  level: z.enum(["low", "medium", "high", "critical"]),
  reasons: z.array(z.string().min(1)).default([])
});

export const traceMetadataSchema = z.object({
  traceId: z.string().uuid(),
  correlationId: z.string().uuid(),
  parentTraceId: z.string().uuid().optional(),
  causationId: z.string().uuid().optional()
});

export const sessionHintSchema = z.object({
  sessionId: z.string().min(1).optional(),
  conversationId: z.string().min(1).optional(),
  turnId: z.string().min(1).optional()
});

export const ingressExternalMessagePayloadSchema = z.object({
  payloadSchemaVersion: z.literal("1.0"),
  channelMessageId: z.string().min(1),
  text: z.string().min(1),
  rawContentRef: z.string().min(1).optional(),
  metadata: z.record(z.unknown()).default({})
});

export const approvalDecisionPayloadSchema = z.object({
  payloadSchemaVersion: z.literal("1.0"),
  intentId: z.string().min(1),
  intentHash: z.string().min(1),
  decision: z.enum(["APPROVED", "REJECTED"]),
  approverId: z.string().min(1),
  expiresAt: z.string().datetime({ offset: true })
});

export const toolExecutionResultPayloadSchema = z.object({
  payloadSchemaVersion: z.literal("1.0"),
  executionId: z.string().min(1),
  toolName: z.string().min(1),
  status: z.enum(["succeeded", "failed"]),
  resultRef: z.string().min(1).optional(),
  errorMessage: z.string().min(1).optional()
});

export const serviceLifecyclePayloadSchema = z.object({
  payloadSchemaVersion: z.literal("1.0"),
  state: z.enum(["starting", "ready", "degraded", "stopping"]),
  detail: z.string().optional()
});

export const policyEvaluationRequestPayloadSchema = z.object({
  payloadSchemaVersion: z.literal("1.0"),
  action: z.string().min(1),
  resource: z.string().min(1),
  context: z.record(z.unknown()).default({})
});

export const policyEvaluationResponsePayloadSchema = z.object({
  payloadSchemaVersion: z.literal("1.0"),
  decision: z.enum(["ALLOW", "DENY", "REQUIRE_APPROVAL"]),
  reasonCodes: z.array(z.string().min(1)).default([])
});

export const executionIntentCreatedPayloadSchema = z.object({
  payloadSchemaVersion: z.literal("1.0"),
  intentId: z.string().min(1),
  intentHash: z.string().min(1),
  actionType: z.string().min(1),
  approvalRequired: z.boolean()
});

export const payloadSchemaByEventType = {
  "ingress.external_message.received": ingressExternalMessagePayloadSchema,
  "approval.decision.recorded": approvalDecisionPayloadSchema,
  "tool.execution.result": toolExecutionResultPayloadSchema,
  "service.lifecycle.status": serviceLifecyclePayloadSchema,
  "policy.evaluation.requested": policyEvaluationRequestPayloadSchema,
  "policy.evaluation.responded": policyEvaluationResponsePayloadSchema,
  "execution.intent.created": executionIntentCreatedPayloadSchema
} as const;

type PayloadByEventType = {
  [K in keyof typeof payloadSchemaByEventType]: z.infer<(typeof payloadSchemaByEventType)[K]>;
};

export type EventPayloadByType<TType extends EventType> = PayloadByEventType[TType];

const envelopeBaseSchema = z.object({
  envelopeVersion: eventEnvelopeVersionSchema,
  eventId: z.string().uuid(),
  eventType: eventTypeSchema,
  eventCategory: eventCategorySchema,
  timestamp: z.string().datetime({ offset: true }),
  tenantId: z.string().min(1),
  workspaceId: z.string().min(1),
  actor: principalReferenceSchema,
  channel: principalReferenceSchema,
  source: sourceSchema,
  session: sessionHintSchema,
  trace: traceMetadataSchema,
  trust: z.object({
    classification: trustClassSchema,
    promotedFromEventId: z.string().uuid().optional()
  }),
  risk: riskMetadataSchema,
  idempotency: z.object({
    key: z.string().min(1),
    nonce: z.string().min(16),
    dedupeWindowSeconds: z.number().int().positive().default(86400)
  }),
  causality: z.object({
    parentEventId: z.string().uuid().optional(),
    causationEventId: z.string().uuid().optional()
  }),
  attachments: z.array(attachmentSchema).default([]),
  producer: z.object({
    serviceName: serviceNameSchema,
    serviceVersion: z.string().min(1),
    environment: z.enum(["local", "dev", "test", "staging", "production"])
  }),
  delivery: z.object({
    attempt: z.number().int().positive().default(1),
    maxAttempts: z.number().int().positive().default(5),
    publishedAt: z.string().datetime({ offset: true }),
    lastAttemptAt: z.string().datetime({ offset: true }).optional()
  }),
  integrity: z.object({
    algorithm: z.enum(["sha256", "hmac-sha256"]),
    payloadHash: z.string().min(1),
    signature: z.string().min(1).optional(),
    keyId: z.string().min(1).optional()
  }),
  payload: z.unknown()
});

export const canonicalEventEnvelopeSchema = envelopeBaseSchema.superRefine((value, ctx) => {
  const payloadSchema = payloadSchemaByEventType[value.eventType];
  const payloadParse = payloadSchema.safeParse(value.payload);
  if (!payloadParse.success) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Payload does not match schema for ${value.eventType}: ${payloadParse.error.issues
        .map((issue) => `${issue.path.join(".") || "(root)"} ${issue.message}`)
        .join("; ")}`
    });
  }
  if (value.eventCategory !== eventTypeCategoryMap[value.eventType]) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Event category ${value.eventCategory} does not match expected category ${eventTypeCategoryMap[value.eventType]}`
    });
  }
  if (value.source.sourceType !== "service" && value.integrity.algorithm === "hmac-sha256") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "hmac-sha256 integrity is reserved for service-origin events"
    });
  }
});

export type CanonicalEventEnvelope = z.infer<typeof canonicalEventEnvelopeSchema>;

export interface BuildEventInput<TType extends EventType> {
  eventType: TType;
  tenantId: string;
  workspaceId: string;
  actor: z.infer<typeof principalReferenceSchema>;
  channel: z.infer<typeof principalReferenceSchema>;
  source: z.infer<typeof sourceSchema>;
  trace: z.infer<typeof traceMetadataSchema>;
  payload: EventPayloadByType<TType>;
  trustClassification: TrustClass;
  risk: z.infer<typeof riskMetadataSchema>;
  session?: z.infer<typeof sessionHintSchema>;
  attachments?: z.infer<typeof attachmentSchema>[];
  idempotencyKey: string;
  parentEventId?: string;
  causationEventId?: string;
  producer: ProducerMetadata;
  maxAttempts?: number;
}

type ProducerMetadata = z.infer<typeof envelopeBaseSchema>["producer"];

export function createCanonicalEvent<TType extends EventType>(
  input: Omit<BuildEventInput<TType>, "producer"> & { producer: ProducerMetadata }
): CanonicalEventEnvelope {
  const now = new Date().toISOString();
  const event: Omit<CanonicalEventEnvelope, "integrity"> = {
    envelopeVersion: EVENT_ENVELOPE_VERSION,
    eventId: randomUUID(),
    eventType: input.eventType,
    eventCategory: eventTypeCategoryMap[input.eventType],
    timestamp: now,
    tenantId: input.tenantId,
    workspaceId: input.workspaceId,
    actor: input.actor,
    channel: input.channel,
    source: input.source,
    session: input.session ?? {},
    trace: input.trace,
    trust: {
      classification: input.trustClassification
    },
    risk: input.risk,
    idempotency: {
      key: input.idempotencyKey,
      nonce: randomUUID().replace(/-/g, ""),
      dedupeWindowSeconds: 86400
    },
    causality: {
      ...(input.parentEventId ? { parentEventId: input.parentEventId } : {}),
      ...(input.causationEventId ? { causationEventId: input.causationEventId } : {})
    },
    attachments: input.attachments ?? [],
    producer: input.producer,
    delivery: {
      attempt: 1,
      maxAttempts: input.maxAttempts ?? 5,
      publishedAt: now
    },
    payload: input.payload
  };
  return attachEventIntegrity(event);
}

function stableStringify(input: unknown): string {
  if (input === null || typeof input !== "object") {
    return JSON.stringify(input);
  }
  if (Array.isArray(input)) {
    return `[${input.map((item) => stableStringify(item)).join(",")}]`;
  }
  const object = input as Record<string, unknown>;
  const keys = Object.keys(object).sort();
  const parts = keys.map((key) => `${JSON.stringify(key)}:${stableStringify(object[key])}`);
  return `{${parts.join(",")}}`;
}

export function computeEventPayloadHash(
  event: Omit<CanonicalEventEnvelope, "integrity"> | CanonicalEventEnvelope
): string {
  const clone = {
    envelopeVersion: event.envelopeVersion,
    eventId: event.eventId,
    eventType: event.eventType,
    eventCategory: event.eventCategory,
    timestamp: event.timestamp,
    tenantId: event.tenantId,
    workspaceId: event.workspaceId,
    actor: event.actor,
    channel: event.channel,
    source: event.source,
    session: event.session,
    trace: event.trace,
    trust: event.trust,
    risk: event.risk,
    idempotency: event.idempotency,
    causality: event.causality,
    attachments: event.attachments,
    producer: event.producer,
    payload: event.payload
  };
  return createHash("sha256").update(stableStringify(clone), "utf8").digest("hex");
}

export function attachEventIntegrity(
  event: Omit<CanonicalEventEnvelope, "integrity">,
  signing?: { keyId: string; secret: string }
): CanonicalEventEnvelope {
  const payloadHash = computeEventPayloadHash(event);
  if (signing) {
    const signature = createHmac("sha256", signing.secret).update(payloadHash, "utf8").digest("hex");
    return {
      ...event,
      integrity: {
        algorithm: "hmac-sha256",
        payloadHash,
        signature,
        keyId: signing.keyId
      }
    };
  }
  return {
    ...event,
    integrity: {
      algorithm: "sha256",
      payloadHash
    }
  };
}

export type IntegrityVerificationResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "HASH_MISMATCH"
        | "SIGNATURE_REQUIRED"
        | "SIGNATURE_MISSING"
        | "KEY_ID_MISSING"
        | "SIGNATURE_INVALID";
    };

export function verifyEventIntegrity(
  event: CanonicalEventEnvelope,
  options?: {
    requiredForInternal?: boolean;
    signingSecretsByKeyId?: Record<string, string>;
  }
): IntegrityVerificationResult {
  const expectedHash = computeEventPayloadHash(event);
  if (event.integrity.payloadHash !== expectedHash) {
    return { ok: false, reason: "HASH_MISMATCH" };
  }

  const requireSignature = options?.requiredForInternal && event.source.sourceType === "service";
  if (requireSignature && event.integrity.algorithm !== "hmac-sha256") {
    return { ok: false, reason: "SIGNATURE_REQUIRED" };
  }

  if (event.integrity.algorithm === "hmac-sha256") {
    if (!event.integrity.signature) {
      return { ok: false, reason: "SIGNATURE_MISSING" };
    }
    if (!event.integrity.keyId) {
      return { ok: false, reason: "KEY_ID_MISSING" };
    }
    const secret = options?.signingSecretsByKeyId?.[event.integrity.keyId];
    if (!secret) {
      return { ok: false, reason: "SIGNATURE_INVALID" };
    }
    const expectedSignature = createHmac("sha256", secret).update(expectedHash, "utf8").digest("hex");
    if (expectedSignature !== event.integrity.signature) {
      return { ok: false, reason: "SIGNATURE_INVALID" };
    }
  }

  return { ok: true };
}

export function parseCanonicalEvent(input: unknown): CanonicalEventEnvelope {
  const parsed = canonicalEventEnvelopeSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(
      `Invalid canonical event envelope: ${parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "(root)"} ${issue.message}`)
        .join("; ")}`
    );
  }
  return parsed.data;
}
