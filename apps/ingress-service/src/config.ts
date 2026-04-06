import { z } from "zod";

import { baseServiceConfigSchema, loadValidatedConfig } from "@manasvi/service-runtime";

const ingressConfigSchema = baseServiceConfigSchema.extend({
  serviceName: z.literal("ingress-service"),
  port: z.number().int().min(1).max(65535).default(4101),
  channelSignatureRequired: z.boolean().default(true),
  signingKeyId: z.string().min(1).default("local-key"),
  eventBusTargetUrls: z.array(z.string().url()).min(1),
  internalAuthIssuer: z.string().min(1).default("manasvi.internal.auth"),
  internalAuthAudience: z.string().min(1).default("manasvi.internal.services"),
  internalAuthKeyId: z.string().min(1),
  internalAuthSigningSecret: z.string().min(1),
  internalAuthTokenTtlSeconds: z.number().int().positive().max(900).default(120)
});

export type IngressServiceConfig = z.infer<typeof ingressConfigSchema>;

export async function loadIngressServiceConfig(): Promise<IngressServiceConfig> {
  return loadValidatedConfig({
    serviceName: "ingress-service",
    schema: ingressConfigSchema,
    buildConfig: async ({ env, profile, secrets }) => ({
      serviceName: "ingress-service",
      serviceVersion: env.SERVICE_VERSION ?? "0.1.0",
      environment: profile,
      host: env.SERVICE_HOST ?? "0.0.0.0",
      port: Number(env.SERVICE_PORT ?? 4101),
      logLevel: env.LOG_LEVEL ?? "info",
      humanReadableLogs: env.HUMAN_LOGS === "true",
      channelSignatureRequired: env.CHANNEL_SIGNATURE_REQUIRED !== "false",
      signingKeyId:
        (profile === "staging" || profile === "production")
          ? await secrets.require("INGRESS_SIGNING_KEY_ID")
          : (await secrets.optional("INGRESS_SIGNING_KEY_ID")) ?? "local-key",
      eventBusTargetUrls: (env.EVENT_BUS_TARGET_URLS ?? "http://localhost:4102/internal/events")
        .split(",")
        .map((value) => value.trim())
        .filter((value) => value.length > 0),
      internalAuthIssuer: env.INTERNAL_AUTH_ISSUER ?? "manasvi.internal.auth",
      internalAuthAudience: env.INTERNAL_AUTH_AUDIENCE ?? "manasvi.internal.services",
      internalAuthKeyId: await secrets.require("INTERNAL_AUTH_KEY_ID"),
      internalAuthSigningSecret: await secrets.require("INTERNAL_AUTH_SIGNING_SECRET"),
      internalAuthTokenTtlSeconds: Number(env.INTERNAL_AUTH_TOKEN_TTL_SECONDS ?? 120)
    })
  });
}
