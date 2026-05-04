import { z } from "zod";

import { baseServiceConfigSchema, loadValidatedConfig } from "@manasvi/service-runtime";

export const approvalServiceConfigSchema = baseServiceConfigSchema.extend({
  serviceName: z.literal("approval-service"),
  port: z.number().int().min(1).max(65535).default(4108),
  internalAuthIssuer: z.string().min(1).default("manasvi.internal.auth"),
  internalAuthAudience: z.string().min(1).default("manasvi.internal.services"),
  internalAuthVerificationKeys: z.record(z.string().min(1)).refine((value) => Object.keys(value).length > 0, {
    message: "At least one internal auth verification key is required"
  }),
  intentVerificationKeys: z.record(z.string().min(1)).refine((value) => Object.keys(value).length > 0, {
    message: "At least one intent verification key is required"
  }),
  approvalSigningKeyId: z.string().min(1),
  approvalSigningSecret: z.string().min(1),
  approvalRequestTtlSeconds: z.number().int().positive().max(86400).default(3600),
  approvedArtifactTtlSeconds: z.number().int().positive().max(86400).default(900),
  approvalAuditBufferSize: z.number().int().positive().default(1000)
});

export type ApprovalServiceConfig = z.infer<typeof approvalServiceConfigSchema>;

function parseKeyMap(value: string | undefined): Record<string, string> {
  return (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .reduce<Record<string, string>>((acc, entry) => {
      const separator = entry.indexOf(":");
      if (separator <= 0 || separator >= entry.length - 1) {
        return acc;
      }
      const keyId = entry.slice(0, separator).trim();
      const secret = entry.slice(separator + 1).trim();
      if (!keyId || !secret) {
        return acc;
      }
      acc[keyId] = secret;
      return acc;
    }, {});
}

export async function loadApprovalServiceConfig(): Promise<ApprovalServiceConfig> {
  return loadValidatedConfig({
    serviceName: "approval-service",
    schema: approvalServiceConfigSchema,
    buildConfig: async ({ env, profile, secrets }) => {
      const internalAuthVerificationKeys = parseKeyMap(await secrets.require("INTERNAL_AUTH_VERIFICATION_KEYS"));
      const intentVerificationKeysFromEnv = parseKeyMap((await secrets.optional("INTENT_VERIFICATION_KEYS")) ?? "");
      const intentSigningKeyId = await secrets.optional("INTENT_SIGNING_KEY_ID");
      const intentSigningSecret = await secrets.optional("INTENT_SIGNING_SECRET");
      const intentVerificationKeys: Record<string, string> = {
        ...internalAuthVerificationKeys,
        ...intentVerificationKeysFromEnv
      };
      if (intentSigningKeyId && intentSigningSecret) {
        intentVerificationKeys[intentSigningKeyId.trim()] = intentSigningSecret.trim();
      }
      const approvalSigningKeys = parseKeyMap(await secrets.require("APPROVAL_SIGNING_KEYS"));
      const approvalSigningKeyId =
        (await secrets.optional("APPROVAL_SIGNING_KEY_ID")) ?? Object.keys(approvalSigningKeys)[0] ?? "";
      const approvalSigningSecret = approvalSigningKeys[approvalSigningKeyId];
      return {
        serviceName: "approval-service",
        serviceVersion: env.SERVICE_VERSION ?? "0.1.0",
        environment: profile,
        host: env.SERVICE_HOST ?? "0.0.0.0",
        port: Number(env.SERVICE_PORT ?? 4108),
        logLevel: env.LOG_LEVEL ?? "info",
        humanReadableLogs: env.HUMAN_LOGS === "true",
        internalAuthIssuer: env.INTERNAL_AUTH_ISSUER ?? "manasvi.internal.auth",
        internalAuthAudience: env.INTERNAL_AUTH_AUDIENCE ?? "manasvi.internal.services",
        internalAuthVerificationKeys,
        intentVerificationKeys,
        approvalSigningKeyId,
        approvalSigningSecret: approvalSigningSecret ?? "",
        approvalRequestTtlSeconds: Number(env.APPROVAL_REQUEST_TTL_SECONDS ?? 3600),
        approvedArtifactTtlSeconds: Number(env.APPROVED_ARTIFACT_TTL_SECONDS ?? 900),
        approvalAuditBufferSize: Number(env.APPROVAL_AUDIT_BUFFER_SIZE ?? 1000)
      };
    }
  });
}
