import { z } from "zod";

import { baseServiceConfigSchema, loadValidatedConfig } from "@manasvi/service-runtime";

export const policyConfigSchema = baseServiceConfigSchema.extend({
  serviceName: z.literal("policy-service"),
  port: z.number().int().min(1).max(65535).default(4103),
  defaultDecisionTtlSeconds: z.number().int().positive().default(300),
  policySetPath: z.string().min(1).default("configs/policies/default-policy-set.json"),
  policySetMapJson: z.string().default("{}"),
  internalAuthIssuer: z.string().min(1).default("manasvi.internal.auth"),
  internalAuthAudience: z.string().min(1).default("manasvi.internal.services"),
  internalAuthVerificationKeys: z.record(z.string().min(1)).refine((value) => Object.keys(value).length > 0, {
    message: "At least one internal auth verification key is required"
  }),
  decisionAuditBufferSize: z.number().int().positive().max(5000).default(500)
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
      policySetPath: env.POLICY_SET_PATH ?? "configs/policies/default-policy-set.json",
      policySetMapJson: env.POLICY_SET_MAP_JSON ?? "{}",
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
      decisionAuditBufferSize: Number(env.POLICY_DECISION_AUDIT_BUFFER_SIZE ?? 500),
      policySigningKey:
        profile === "staging" || profile === "production"
          ? await secrets.require("POLICY_SIGNING_KEY")
          : await secrets.optional("POLICY_SIGNING_KEY")
    })
  });
}
