import { z } from "zod";

import { baseServiceConfigSchema, loadValidatedConfig } from "@manasvi/service-runtime";

export const nodeManagerConfigSchema = baseServiceConfigSchema.extend({
  serviceName: z.literal("node-manager"),
  port: z.number().int().min(1).max(65535).default(4106),
  pairingTtlSeconds: z.number().int().positive().default(600),
  principalRegistryPath: z.string().min(1).default("/tmp/manasvi/node-manager-principals.json"),
  internalAuthIssuer: z.string().min(1).default("manasvi.internal.auth"),
  internalAuthAudience: z.string().min(1).default("manasvi.internal.services"),
  internalAuthVerificationKeys: z.record(z.string().min(1)).refine((value) => Object.keys(value).length > 0, {
    message: "At least one internal auth verification key is required"
  })
});

export type NodeManagerConfig = z.infer<typeof nodeManagerConfigSchema>;

export async function loadNodeManagerConfig(): Promise<NodeManagerConfig> {
  return loadValidatedConfig({
    serviceName: "node-manager",
    schema: nodeManagerConfigSchema,
    buildConfig: async ({ env, profile, secrets }) => ({
      serviceName: "node-manager",
      serviceVersion: env.SERVICE_VERSION ?? "0.1.0",
      environment: profile,
      host: env.SERVICE_HOST ?? "0.0.0.0",
      port: Number(env.SERVICE_PORT ?? 4106),
      logLevel: env.LOG_LEVEL ?? "info",
      humanReadableLogs: env.HUMAN_LOGS === "true",
      pairingTtlSeconds: Number(env.NODE_PAIRING_TTL_SECONDS ?? 600),
      principalRegistryPath:
        env.PRINCIPAL_REGISTRY_PATH ?? "/tmp/manasvi/node-manager-principals.json",
      internalAuthIssuer: env.INTERNAL_AUTH_ISSUER ?? "manasvi.internal.auth",
      internalAuthAudience: env.INTERNAL_AUTH_AUDIENCE ?? "manasvi.internal.services",
      internalAuthVerificationKeys: (await secrets.require("INTERNAL_AUTH_VERIFICATION_KEYS"))
        .split(",")
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0)
        .reduce<Record<string, string>>((acc, entry) => {
          const separator = entry.indexOf(":");
          if (separator <= 0 || separator >= entry.length - 1) {
            return acc;
          }
          const keyId = entry.slice(0, separator);
          const secret = entry.slice(separator + 1);
          acc[keyId] = secret;
          return acc;
        }, {}),
      nodeSigningKey:
        profile === "staging" || profile === "production"
          ? await secrets.require("NODE_MANAGER_SIGNING_KEY")
          : await secrets.optional("NODE_MANAGER_SIGNING_KEY")
    })
  });
}
