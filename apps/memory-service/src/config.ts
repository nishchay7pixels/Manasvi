import { z } from "zod";

import { baseServiceConfigSchema, loadValidatedConfig } from "@manasvi/service-runtime";

export const memoryConfigSchema = baseServiceConfigSchema.extend({
  serviceName: z.literal("memory-service"),
  port: z.number().int().min(1).max(65535).default(4105),
  defaultTtlSeconds: z.number().int().positive().default(3600)
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
      memoryEncryptionKey:
        profile === "staging" || profile === "production"
          ? await secrets.require("MEMORY_ENCRYPTION_KEY")
          : await secrets.optional("MEMORY_ENCRYPTION_KEY")
    })
  });
}

