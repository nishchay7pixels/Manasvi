import { z } from "zod";
import { baseServiceConfigSchema, loadValidatedConfig } from "@manasvi/service-runtime";

const extensionRuntimeConfigSchema = baseServiceConfigSchema.extend({
  serviceName: z.literal("extension-runtime"),
  port: z.number().int().min(1).max(65535).default(4109),

  // Internal auth
  internalAuthIssuer: z.string().min(1).default("manasvi.internal.auth"),
  internalAuthAudience: z.string().min(1).default("manasvi.internal.services"),
  internalAuthKeyId: z.string().min(1),
  internalAuthSigningSecret: z.string().min(1),
  internalAuthTokenTtlSeconds: z.number().int().positive().max(900).default(120),

  // Policy service
  policyServiceBaseUrl: z.string().url().default("http://localhost:4103"),

  // Plugin process limits
  maxConcurrentPlugins: z.number().int().positive().default(10),
  pluginHandshakeTimeoutMs: z.number().int().positive().default(15000),
  pluginHealthCheckIntervalMs: z.number().int().positive().default(30000),
  pluginShutdownTimeoutMs: z.number().int().positive().default(5000),

  // Capability approval
  requireExplicitCapabilityApproval: z.boolean().default(true),

  // Provenance / signing
  pluginSigningKeySecrets: z.string().default("{}"),

  // Plugin base dir
  pluginBaseDir: z.string().default(process.cwd())
});

export type ExtensionRuntimeConfig = z.infer<typeof extensionRuntimeConfigSchema>;

export async function loadExtensionRuntimeConfig(): Promise<ExtensionRuntimeConfig> {
  return loadValidatedConfig({
    serviceName: "extension-runtime",
    schema: extensionRuntimeConfigSchema,
    buildConfig: async ({ env, secrets }) => ({
      serviceName: "extension-runtime",
      serviceVersion: env["SERVICE_VERSION"] ?? "0.1.0",
      environment: env["MANASVI_ENV"] ?? "local",
      host: env["SERVICE_HOST"] ?? "0.0.0.0",
      port: Number(env["PORT"] ?? 4109),
      logLevel: env["LOG_LEVEL"] ?? "info",
      humanReadableLogs: env["HUMAN_LOGS"] === "true",

      internalAuthIssuer: env["INTERNAL_AUTH_ISSUER"] ?? "manasvi.internal.auth",
      internalAuthAudience: env["INTERNAL_AUTH_AUDIENCE"] ?? "manasvi.internal.services",
      internalAuthKeyId: await secrets.require("INTERNAL_AUTH_KEY_ID"),
      internalAuthSigningSecret: await secrets.require("INTERNAL_AUTH_SIGNING_SECRET"),
      internalAuthTokenTtlSeconds: Number(env["INTERNAL_AUTH_TOKEN_TTL_SECONDS"] ?? 120),

      policyServiceBaseUrl: env["POLICY_SERVICE_BASE_URL"] ?? "http://localhost:4103",

      maxConcurrentPlugins: Number(env["EXTENSION_MAX_CONCURRENT_PLUGINS"] ?? 10),
      pluginHandshakeTimeoutMs: Number(env["EXTENSION_PLUGIN_HANDSHAKE_TIMEOUT_MS"] ?? 15000),
      pluginHealthCheckIntervalMs: Number(env["EXTENSION_PLUGIN_HEALTH_CHECK_INTERVAL_MS"] ?? 30000),
      pluginShutdownTimeoutMs: Number(env["EXTENSION_PLUGIN_SHUTDOWN_TIMEOUT_MS"] ?? 5000),

      requireExplicitCapabilityApproval:
        (env["EXTENSION_REQUIRE_EXPLICIT_CAPABILITY_APPROVAL"] ?? "true") !== "false",

      pluginSigningKeySecrets: env["EXTENSION_PLUGIN_SIGNING_KEY_SECRETS"] ?? "{}",
      pluginBaseDir: env["EXTENSION_PLUGIN_BASE_DIR"] ?? process.cwd()
    })
  });
}
