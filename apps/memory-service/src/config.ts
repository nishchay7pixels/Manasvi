import { z } from "zod";

import { baseServiceConfigSchema, loadValidatedConfig } from "@manasvi/service-runtime";

export const memoryConfigSchema = baseServiceConfigSchema.extend({
  serviceName: z.literal("memory-service"),
  port: z.number().int().min(1).max(65535).default(4105),
  defaultTtlSeconds: z.number().int().positive().default(3600),
  ephemeralTtlSeconds: z.number().int().positive().default(3600),
  untrustedTtlSeconds: z.number().int().positive().default(7200),
  retentionPruneIntervalSeconds: z.number().int().positive().default(300),
  policyServiceBaseUrl: z.string().url().default("http://localhost:4103"),
  internalAuthIssuer: z.string().min(1).default("manasvi.internal.auth"),
  internalAuthAudience: z.string().min(1).default("manasvi.internal.services"),
  internalAuthKeyId: z.string().min(1),
  internalAuthSigningSecret: z.string().min(1),
  internalAuthVerificationKeys: z.record(z.string().min(1)).refine((value) => Object.keys(value).length > 0, {
    message: "At least one internal auth verification key is required"
  }),
  memoryEncryptionKey: z.string().min(16),
  memoryEncryptionKeyRef: z.string().min(1).default("memory-key:local")
});

export type MemoryServiceConfig = z.infer<typeof memoryConfigSchema>;

export async function loadMemoryServiceConfig(): Promise<MemoryServiceConfig> {
  return loadValidatedConfig({
    serviceName: "memory-service",
    schema: memoryConfigSchema,
    buildConfig: async ({ env, profile, secrets }) => ({
      serviceName: "memory-service",
      serviceVersion: env.SERVICE_VERSION ?? "0.1.0",
      environment: profile,
      host: env.SERVICE_HOST ?? "0.0.0.0",
      port: Number(env.SERVICE_PORT ?? 4105),
      logLevel: env.LOG_LEVEL ?? "info",
      humanReadableLogs: env.HUMAN_LOGS === "true",
      defaultTtlSeconds: Number(env.DEFAULT_MEMORY_TTL_SECONDS ?? 3600),
      ephemeralTtlSeconds: Number(env.MEMORY_EPHEMERAL_TTL_SECONDS ?? 3600),
      untrustedTtlSeconds: Number(env.MEMORY_UNTRUSTED_TTL_SECONDS ?? 7200),
      retentionPruneIntervalSeconds: Number(env.MEMORY_RETENTION_PRUNE_INTERVAL_SECONDS ?? 300),
      policyServiceBaseUrl: env.POLICY_SERVICE_BASE_URL ?? "http://localhost:4103",
      internalAuthIssuer: env.INTERNAL_AUTH_ISSUER ?? "manasvi.internal.auth",
      internalAuthAudience: env.INTERNAL_AUTH_AUDIENCE ?? "manasvi.internal.services",
      internalAuthKeyId: await secrets.require("INTERNAL_AUTH_KEY_ID"),
      internalAuthSigningSecret: await secrets.require("INTERNAL_AUTH_SIGNING_SECRET"),
      internalAuthVerificationKeys: (await secrets.require("INTERNAL_AUTH_VERIFICATION_KEYS"))
        .split(",")
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0)
        .reduce<Record<string, string>>((acc, entry) => {
          const separator = entry.indexOf(":");
          if (separator <= 0 || separator >= entry.length - 1) {
            return acc;
          }
          acc[entry.slice(0, separator)] = entry.slice(separator + 1);
          return acc;
        }, {}),
      memoryEncryptionKey:
        (await secrets.optional("MEMORY_ENCRYPTION_KEY")) ??
        (profile === "local" ? "manasvi-local-memory-encryption-key" : await secrets.require("MEMORY_ENCRYPTION_KEY")),
      memoryEncryptionKeyRef: env.MEMORY_ENCRYPTION_KEY_REF ?? "memory-key:local"
    })
  });
}
