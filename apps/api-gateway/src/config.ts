import { z } from "zod";

import { baseServiceConfigSchema, loadValidatedConfig } from "@manasvi/service-runtime";

export const apiGatewayConfigSchema = baseServiceConfigSchema.extend({
  serviceName: z.literal("api-gateway"),
  port: z.number().int().min(1).max(65535).default(4100),
  ingressBaseUrl: z.string().url().default("http://ingress-service:4101"),
  orchestratorBaseUrl: z.string().url().default("http://orchestrator-service:4102")
});

export type ApiGatewayConfig = z.infer<typeof apiGatewayConfigSchema>;

export async function loadApiGatewayConfig(): Promise<ApiGatewayConfig> {
  return loadValidatedConfig({
    serviceName: "api-gateway",
    schema: apiGatewayConfigSchema,
    buildConfig: async ({ env, profile, secrets }) => ({
      serviceName: "api-gateway",
      serviceVersion: env.SERVICE_VERSION ?? "0.1.0",
      environment: profile,
      host: env.SERVICE_HOST ?? "0.0.0.0",
      port: Number(env.SERVICE_PORT ?? 4100),
      logLevel: env.LOG_LEVEL ?? "info",
      humanReadableLogs: env.HUMAN_LOGS === "true",
      ingressBaseUrl: env.INGRESS_BASE_URL ?? "http://ingress-service:4101",
      orchestratorBaseUrl: env.ORCHESTRATOR_BASE_URL ?? "http://orchestrator-service:4102",
      gatewayAuthToken:
        profile === "staging" || profile === "production"
          ? await secrets.require("API_GATEWAY_AUTH_TOKEN")
          : await secrets.optional("API_GATEWAY_AUTH_TOKEN")
    })
  });
}

