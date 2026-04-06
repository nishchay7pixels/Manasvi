import { z } from "zod";

import { baseServiceConfigSchema, loadValidatedConfig } from "@manasvi/service-runtime";

export const policyConfigSchema = baseServiceConfigSchema.extend({
  serviceName: z.literal("policy-service"),
  port: z.number().int().min(1).max(65535).default(4103),
  defaultDecisionTtlSeconds: z.number().int().positive().default(300)
});

export type PolicyServiceConfig = z.infer<typeof policyConfigSchema>;

export async function loadPolicyServiceConfig(): Promise<PolicyServiceConfig> {
  return loadValidatedConfig({
    serviceName: "policy-service",
    schema: policyConfigSchema,
    buildConfig: async ({ env, profile, secrets }) => ({
      serviceName: "policy-service",
      serviceVersion: env.SERVICE_VERSION ?? "0.1.0",
      environment: profile,
      host: env.SERVICE_HOST ?? "0.0.0.0",
      port: Number(env.SERVICE_PORT ?? 4103),
      logLevel: env.LOG_LEVEL ?? "info",
      humanReadableLogs: env.HUMAN_LOGS === "true",
      defaultDecisionTtlSeconds: Number(env.DEFAULT_DECISION_TTL_SECONDS ?? 300),
      policySigningKey:
        profile === "staging" || profile === "production"
          ? await secrets.require("POLICY_SIGNING_KEY")
          : await secrets.optional("POLICY_SIGNING_KEY")
    })
  });
}

