import { randomUUID } from "node:crypto";
import { z } from "zod";

import { CONTRACT_SCHEMA_VERSION, trustClassSchema } from "./base.js";
import { principalReferenceSchema } from "./identity.js";
import { policyTraceSchema } from "./policy.js";

export const SECRET_CONTRACT_VERSION = "1.0" as const;

const legacySecretRefPattern = /^secret:[A-Za-z0-9._/\-:]+$/;
const uriSecretRefPattern = /^secret:\/\/[A-Za-z0-9._/\-:]+$/;

export const secretReferenceStringSchema = z
  .string()
  .min(1)
  .refine(
    (value) => legacySecretRefPattern.test(value) || uriSecretRefPattern.test(value),
    "Secret reference must be formatted as secret:<id> or secret://<namespace>/<id>"
  );
export type SecretReferenceString = z.infer<typeof secretReferenceStringSchema>;

export const secretReferenceSchema = z.object({
  schemaVersion: z.literal(SECRET_CONTRACT_VERSION),
  reference: secretReferenceStringSchema,
  provider: z.string().min(1),
  category: z.enum([
    "channel_credential",
    "api_token",
    "signing_key",
    "runtime_secret",
    "plugin_secret",
    "node_secret",
    "internal_auth_secret"
  ]),
  sensitivity: z.enum(["standard", "high", "critical"]).default("high"),
  trustClassification: trustClassSchema.default("SECRET_SENSITIVE"),
  tenantId: z.string().min(1).optional(),
  workspaceId: z.string().min(1).optional(),
  ownerPrincipal: principalReferenceSchema.optional(),
  allowedConsumerTypes: z
    .array(
      z.enum([
        "adapter-runtime",
        "tool-runtime",
        "plugin-runtime",
        "node-runtime",
        "execution-manager",
        "orchestrator",
        "service-config"
      ])
    )
    .default([]),
  tags: z.array(z.string().min(1)).default([]),
  rotation: z
    .object({
      version: z.string().min(1).optional(),
      rotatedAt: z.string().datetime({ offset: true }).optional(),
      rotationHint: z.string().min(1).optional()
    })
    .default({})
});
export type SecretReference = z.infer<typeof secretReferenceSchema>;

export const secretBindingSchema = z.object({
  schemaVersion: z.literal(SECRET_CONTRACT_VERSION),
  bindingId: z.string().min(1),
  consumerType: z.enum(["tool", "plugin", "adapter", "node", "service"]),
  consumerId: z.string().min(1),
  reference: secretReferenceStringSchema,
  purpose: z.string().min(1),
  required: z.boolean().default(true),
  createdAt: z.string().datetime({ offset: true })
});
export type SecretBinding = z.infer<typeof secretBindingSchema>;

export const secretAccessRequestSchema = z.object({
  schemaVersion: z.literal(SECRET_CONTRACT_VERSION),
  requestId: z.string().min(1),
  requestedAt: z.string().datetime({ offset: true }),
  reference: secretReferenceStringSchema,
  consumerType: z.enum([
    "adapter-runtime",
    "tool-runtime",
    "plugin-runtime",
    "node-runtime",
    "execution-manager",
    "orchestrator",
    "service-config"
  ]),
  consumerId: z.string().min(1),
  purpose: z.string().min(1),
  actor: principalReferenceSchema,
  caller: principalReferenceSchema,
  tenantId: z.string().min(1),
  workspaceId: z.string().min(1),
  trace: policyTraceSchema,
  rawValueExposureRequested: z.boolean().default(false),
  runtimeContext: z
    .object({
      sandboxMode: z.string().min(1).optional(),
      nodeId: z.string().min(1).optional(),
      pluginId: z.string().min(1).optional(),
      toolId: z.string().min(1).optional()
    })
    .default({})
});
export type SecretAccessRequest = z.infer<typeof secretAccessRequestSchema>;

export const secretAccessGrantSchema = z.object({
  schemaVersion: z.literal(SECRET_CONTRACT_VERSION),
  grantId: z.string().min(1),
  requestId: z.string().min(1),
  reference: secretReferenceStringSchema,
  approved: z.boolean(),
  reasonCodes: z.array(z.string().min(1)).default([]),
  policyDecisionId: z.string().min(1).optional(),
  policyAuditRecordId: z.string().min(1).optional(),
  expiresAt: z.string().datetime({ offset: true }).optional(),
  rawValueExposureAllowed: z.boolean().default(false),
  issuedAt: z.string().datetime({ offset: true }),
  trace: policyTraceSchema
});
export type SecretAccessGrant = z.infer<typeof secretAccessGrantSchema>;

export const secretUsageRecordSchema = z.object({
  schemaVersion: z.literal(SECRET_CONTRACT_VERSION),
  usageId: z.string().min(1),
  eventType: z.enum([
    "secret.access.requested",
    "secret.access.approved",
    "secret.access.denied",
    "secret.provider.lookup_failed",
    "secret.resolved",
    "secret.injected",
    "secret.injection.denied",
    "secret.exposure.blocked"
  ]),
  timestamp: z.string().datetime({ offset: true }),
  reference: secretReferenceStringSchema,
  consumerType: secretAccessRequestSchema.shape.consumerType,
  consumerId: z.string().min(1),
  actor: principalReferenceSchema.optional(),
  caller: principalReferenceSchema.optional(),
  tenantId: z.string().min(1).optional(),
  workspaceId: z.string().min(1).optional(),
  trace: policyTraceSchema,
  policyDecisionId: z.string().min(1).optional(),
  reasonCodes: z.array(z.string().min(1)).default([]),
  metadata: z.record(z.unknown()).default({})
});
export type SecretUsageRecord = z.infer<typeof secretUsageRecordSchema>;

export function createSecretAccessRequest(
  input: Omit<SecretAccessRequest, "schemaVersion" | "requestId" | "requestedAt" | "runtimeContext"> & {
    runtimeContext?: SecretAccessRequest["runtimeContext"];
  }
): SecretAccessRequest {
  return secretAccessRequestSchema.parse({
    schemaVersion: SECRET_CONTRACT_VERSION,
    requestId: `secret-req:${randomUUID()}`,
    requestedAt: new Date().toISOString(),
    ...input,
    runtimeContext: input.runtimeContext ?? {}
  });
}

export function createSecretAccessGrant(input: {
  requestId: string;
  reference: SecretReferenceString;
  approved: boolean;
  trace: z.infer<typeof policyTraceSchema>;
  policyDecisionId?: string;
  policyAuditRecordId?: string;
  reasonCodes?: string[];
  rawValueExposureAllowed?: boolean;
  expiresAt?: string;
}): SecretAccessGrant {
  return secretAccessGrantSchema.parse({
    schemaVersion: SECRET_CONTRACT_VERSION,
    grantId: `secret-grant:${randomUUID()}`,
    requestId: input.requestId,
    reference: input.reference,
    approved: input.approved,
    reasonCodes: input.reasonCodes ?? [],
    ...(input.policyDecisionId ? { policyDecisionId: input.policyDecisionId } : {}),
    ...(input.policyAuditRecordId ? { policyAuditRecordId: input.policyAuditRecordId } : {}),
    ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
    rawValueExposureAllowed: input.rawValueExposureAllowed ?? false,
    issuedAt: new Date().toISOString(),
    trace: input.trace
  });
}
