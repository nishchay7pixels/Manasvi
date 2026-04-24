import { z } from "zod";

import { baseServiceConfigSchema, loadValidatedConfig } from "@manasvi/service-runtime";

export const nodeAgentConfigSchema = baseServiceConfigSchema.extend({
  serviceName: z.literal("node-agent"),
  port: z.number().int().min(1).max(65535).default(4110),
  nodeId: z.string().min(1),
  nodeClass: z.enum([
    "local_node",
    "trusted_personal_node",
    "restricted_utility_node",
    "high_risk_isolated_node"
  ]),
  nodeManagerBaseUrl: z.string().url().default("http://localhost:4106"),
  nodeDispatchIssuer: z.string().min(1).default("manasvi.node-manager"),
  nodeDispatchAudience: z.string().min(1).default("manasvi.node-agent"),
  nodeDispatchVerificationKeys: z.record(z.string().min(1)).refine((value) => Object.keys(value).length > 0, {
    message: "At least one node dispatch verification key is required"
  }),
  runtimeTokenKeyId: z.string().min(1),
  runtimeTokenSigningSecret: z.string().min(1),
  runtimeTokenVerificationKeys: z.record(z.string().min(1)).refine((value) => Object.keys(value).length > 0, {
    message: "At least one runtime token verification key is required"
  }),
  sandboxRootDir: z.string().min(1).default("/tmp/manasvi-node-agent-runs"),
  sandboxMaxOutputBytes: z.number().int().positive().default(65536)
});

export type NodeAgentConfig = z.infer<typeof nodeAgentConfigSchema>;

export async function loadNodeAgentConfig(): Promise<NodeAgentConfig> {
  return loadValidatedConfig({
    serviceName: "node-agent",
    schema: nodeAgentConfigSchema,
    buildConfig: async ({ env, profile, secrets }) => ({
      serviceName: "node-agent",
      serviceVersion: env.SERVICE_VERSION ?? "0.1.0",
      environment: profile,
      host: env.SERVICE_HOST ?? "0.0.0.0",
      port: Number(env.SERVICE_PORT ?? 4110),
      logLevel: env.LOG_LEVEL ?? "info",
      humanReadableLogs: env.HUMAN_LOGS === "true",
      nodeId: env.NODE_ID ?? "node:local-agent",
      nodeClass: env.NODE_CLASS ?? "restricted_utility_node",
      nodeManagerBaseUrl: env.NODE_MANAGER_BASE_URL ?? "http://localhost:4106",
      nodeDispatchIssuer: env.NODE_CREDENTIAL_ISSUER ?? "manasvi.node-manager",
      nodeDispatchAudience: env.NODE_CREDENTIAL_AUDIENCE ?? "manasvi.node-agent",
      nodeDispatchVerificationKeys: (
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
        }, {}),
      runtimeTokenKeyId: await secrets.require("INTERNAL_AUTH_KEY_ID"),
      runtimeTokenSigningSecret: await secrets.require("INTERNAL_AUTH_SIGNING_SECRET"),
      runtimeTokenVerificationKeys: (await secrets.require("INTERNAL_AUTH_VERIFICATION_KEYS"))
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
      sandboxRootDir: env.SANDBOX_ROOT_DIR ?? "/tmp/manasvi-node-agent-runs",
      sandboxMaxOutputBytes: Number(env.SANDBOX_MAX_OUTPUT_BYTES ?? 65536)
    })
  });
}
