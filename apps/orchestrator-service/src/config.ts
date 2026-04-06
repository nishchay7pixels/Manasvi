import { z } from "zod";

import { baseServiceConfigSchema, loadValidatedConfig } from "@manasvi/service-runtime";

export const orchestratorConfigSchema = baseServiceConfigSchema.extend({
  serviceName: z.literal("orchestrator-service"),
  port: z.number().int().min(1).max(65535).default(4102),
  plannerModel: z.string().min(1).default("placeholder-model"),
  requireSignedInternalEvents: z.boolean().default(true),
  maxEventHandlerAttempts: z.number().int().positive().default(5),
  eventSigningSecretsByKeyId: z.record(z.string().min(1)).default({}),
  policyServiceBaseUrl: z.string().url().default("http://policy-service:4103"),
  internalAuthIssuer: z.string().min(1).default("manasvi.internal.auth"),
  internalAuthAudience: z.string().min(1).default("manasvi.internal.services"),
  internalAuthKeyId: z.string().min(1),
  internalAuthSigningSecret: z.string().min(1),
  internalAuthVerificationKeys: z.record(z.string().min(1)).refine((value) => Object.keys(value).length > 0, {
    message: "At least one internal auth verification key is required"
  })
});

export type OrchestratorServiceConfig = z.infer<typeof orchestratorConfigSchema>;

export async function loadOrchestratorServiceConfig(): Promise<OrchestratorServiceConfig> {
  return loadValidatedConfig({
    serviceName: "orchestrator-service",
    schema: orchestratorConfigSchema,
    buildConfig: async ({ env, profile, secrets }) => ({
      serviceName: "orchestrator-service",
      serviceVersion: env.SERVICE_VERSION ?? "0.1.0",
      environment: profile,
      host: env.SERVICE_HOST ?? "0.0.0.0",
      port: Number(env.SERVICE_PORT ?? 4102),
      logLevel: env.LOG_LEVEL ?? "info",
      humanReadableLogs: env.HUMAN_LOGS === "true",
      plannerModel: env.PLANNER_MODEL ?? "placeholder-model",
      requireSignedInternalEvents: env.REQUIRE_SIGNED_INTERNAL_EVENTS !== "false",
      maxEventHandlerAttempts: Number(env.MAX_EVENT_HANDLER_ATTEMPTS ?? 5),
      policyServiceBaseUrl: env.POLICY_SERVICE_BASE_URL ?? "http://policy-service:4103",
      eventSigningSecretsByKeyId: (env.EVENT_SIGNING_KEYS ?? "")
        .split(",")
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0)
        .reduce<Record<string, string>>((acc, entry) => {
          const [keyId, secret] = entry.split(":");
          if (keyId && secret) {
            acc[keyId] = secret;
          }
          return acc;
        }, {}),
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
      orchestratorSigningKey:
        profile === "staging" || profile === "production"
          ? await secrets.require("ORCHESTRATOR_SIGNING_KEY")
          : await secrets.optional("ORCHESTRATOR_SIGNING_KEY")
    })
  });
}
