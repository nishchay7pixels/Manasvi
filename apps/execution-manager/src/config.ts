import { z } from "zod";

import { baseServiceConfigSchema, loadValidatedConfig } from "@manasvi/service-runtime";

export const executionConfigSchema = baseServiceConfigSchema.extend({
  serviceName: z.literal("execution-manager"),
  port: z.number().int().min(1).max(65535).default(4104),
  policyServiceBaseUrl: z.string().url().default("http://policy-service:4103"),
  internalAuthIssuer: z.string().min(1).default("manasvi.internal.auth"),
  internalAuthAudience: z.string().min(1).default("manasvi.internal.services"),
  internalAuthKeyId: z.string().min(1),
  internalAuthSigningSecret: z.string().min(1),
  internalAuthVerificationKeys: z.record(z.string().min(1)).refine((value) => Object.keys(value).length > 0, {
    message: "At least one internal auth verification key is required"
  }),
  sandboxProfileDefault: z
    .enum(["read_only", "bounded_egress", "mutation_limited", "privileged_reviewed"])
    .default("read_only")
});

export type ExecutionManagerConfig = z.infer<typeof executionConfigSchema>;

export async function loadExecutionManagerConfig(): Promise<ExecutionManagerConfig> {
  return loadValidatedConfig({
    serviceName: "execution-manager",
    schema: executionConfigSchema,
    buildConfig: async ({ env, profile, secrets }) => ({
      serviceName: "execution-manager",
      serviceVersion: env.SERVICE_VERSION ?? "0.1.0",
      environment: profile,
      host: env.SERVICE_HOST ?? "0.0.0.0",
      port: Number(env.SERVICE_PORT ?? 4104),
      logLevel: env.LOG_LEVEL ?? "info",
      humanReadableLogs: env.HUMAN_LOGS === "true",
      policyServiceBaseUrl: env.POLICY_SERVICE_BASE_URL ?? "http://policy-service:4103",
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
      sandboxProfileDefault: env.SANDBOX_PROFILE_DEFAULT ?? "read_only",
      executionControlToken:
        profile === "staging" || profile === "production"
          ? await secrets.require("EXECUTION_CONTROL_TOKEN")
          : await secrets.optional("EXECUTION_CONTROL_TOKEN")
    })
  });
}
