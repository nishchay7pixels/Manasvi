import { z } from "zod";

import { baseServiceConfigSchema, loadValidatedConfig } from "@manasvi/service-runtime";

export const nodeManagerConfigSchema = baseServiceConfigSchema.extend({
  serviceName: z.literal("node-manager"),
  port: z.number().int().min(1).max(65535).default(4106),
  pairingTtlSeconds: z.number().int().positive().default(600),
  nodeCredentialTtlSeconds: z.number().int().positive().max(3600).default(300),
  heartbeatStaleSeconds: z.number().int().positive().max(3600).default(90),
  nodeDispatchTimeoutMs: z.number().int().positive().max(120000).default(20000),
  principalRegistryPath: z.string().min(1).default("/tmp/manasvi/node-manager-principals.json"),
  policyServiceBaseUrl: z.string().url().default("http://localhost:4103"),
  internalAuthIssuer: z.string().min(1).default("manasvi.internal.auth"),
  internalAuthAudience: z.string().min(1).default("manasvi.internal.services"),
  internalAuthKeyId: z.string().min(1),
  internalAuthSigningSecret: z.string().min(1),
  internalAuthVerificationKeys: z.record(z.string().min(1)).refine((value) => Object.keys(value).length > 0, {
    message: "At least one internal auth verification key is required"
  }),
  nodeCredentialIssuer: z.string().min(1).default("manasvi.node-manager"),
  nodeCredentialAudience: z.string().min(1).default("manasvi.node-agent"),
  nodeCredentialKeyId: z.string().min(1),
  nodeCredentialSigningSecret: z.string().min(1),
  nodeCredentialVerificationKeys: z.record(z.string().min(1)).refine((value) => Object.keys(value).length > 0, {
    message: "At least one node credential verification key is required"
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
      nodeCredentialTtlSeconds: Number(env.NODE_CREDENTIAL_TTL_SECONDS ?? 300),
      heartbeatStaleSeconds: Number(env.NODE_HEARTBEAT_STALE_SECONDS ?? 90),
      nodeDispatchTimeoutMs: Number(env.NODE_DISPATCH_TIMEOUT_MS ?? 20000),
      principalRegistryPath:
        env.PRINCIPAL_REGISTRY_PATH ?? "/tmp/manasvi/node-manager-principals.json",
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
          const keyId = entry.slice(0, separator);
          const secret = entry.slice(separator + 1);
          acc[keyId] = secret;
          return acc;
        }, {}),
      nodeCredentialIssuer: env.NODE_CREDENTIAL_ISSUER ?? "manasvi.node-manager",
      nodeCredentialAudience: env.NODE_CREDENTIAL_AUDIENCE ?? "manasvi.node-agent",
      nodeCredentialKeyId: await secrets.optional("NODE_CREDENTIAL_KEY_ID") ?? await secrets.require("INTERNAL_AUTH_KEY_ID"),
      nodeCredentialSigningSecret:
        await secrets.optional("NODE_CREDENTIAL_SIGNING_SECRET") ?? await secrets.require("INTERNAL_AUTH_SIGNING_SECRET"),
      nodeCredentialVerificationKeys: (
        (await secrets.optional("NODE_CREDENTIAL_VERIFICATION_KEYS")) ??
        (await secrets.require("INTERNAL_AUTH_VERIFICATION_KEYS"))
      )
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
        }, {})
    })
  });
}
