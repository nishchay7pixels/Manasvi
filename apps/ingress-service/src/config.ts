import { z } from "zod";

import { baseServiceConfigSchema, loadValidatedConfig } from "@manasvi/service-runtime";

const ingressConfigSchema = baseServiceConfigSchema.extend({
  serviceName: z.literal("ingress-service"),
  port: z.number().int().min(1).max(65535).default(4101),
  channelSignatureRequired: z.boolean().default(true),
  signingKeyId: z.string().min(1).default("local-key"),
  eventSigningSecret: z.string().min(1).optional(),
  eventBusPublishTimeoutMs: z.number().int().positive().max(120000).default(30000),
  eventBusTargetUrls: z.array(z.string().url()).min(1),
  internalAuthIssuer: z.string().min(1).default("manasvi.internal.auth"),
  internalAuthAudience: z.string().min(1).default("manasvi.internal.services"),
  internalAuthKeyId: z.string().min(1),
  internalAuthSigningSecret: z.string().min(1),
  internalAuthTokenTtlSeconds: z.number().int().positive().max(900).default(120),
  orchestratorBaseUrl: z.string().url().default("http://localhost:4102"),
  webUiAdapterRequireAuth: z.boolean().default(true),
  ingressRateLimitWindowMs: z.number().int().positive().max(3600000).default(60000),
  ingressRateLimitMaxPerSource: z.number().int().positive().max(10000).default(60),
  ingressAntiSpamDuplicateTtlMs: z.number().int().positive().max(3600000).default(10000),
  genericWebhookSharedSecret: z.string().min(1).optional(),
  telegramBotToken: z.string().min(1).optional(),
  telegramWebhookSecret: z.string().min(1).optional(),
  telegramApiBaseUrl: z.string().url().default("https://api.telegram.org"),
  /**
   * polling  — Manasvi long-polls Telegram. Default for local/dev. No public URL needed.
   * webhook  — Telegram pushes updates to a public HTTPS endpoint.
   * disabled — Telegram not active even if token is set.
   */
  telegramAdapterMode: z.enum(["polling", "webhook", "disabled"]).default("polling"),
  /** Long-poll timeout in seconds (0–50). Default 25. */
  telegramPollingTimeoutSeconds: z.number().int().min(0).max(50).default(25),
  replyPollTimeoutMs: z.number().int().positive().max(120000).default(12000),
  replyPollIntervalMs: z.number().int().positive().max(5000).default(300),
  slackSigningSecret: z.string().min(1).optional(),
  slackBotToken: z.string().min(1).optional()
});

export type IngressServiceConfig = z.infer<typeof ingressConfigSchema>;

export async function loadIngressServiceConfig(): Promise<IngressServiceConfig> {
  return loadValidatedConfig({
    serviceName: "ingress-service",
    schema: ingressConfigSchema,
    buildConfig: async ({ env, profile, secrets }) => ({
      ...(function () {
        const signingSecretsByKeyId = (env.EVENT_SIGNING_KEYS ?? "")
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
          }, {});
        const requestedKeyId = env.INGRESS_SIGNING_KEY_ID;
        const fallbackKeyId = Object.keys(signingSecretsByKeyId)[0];
        const selectedKeyId = requestedKeyId ?? fallbackKeyId ?? "local-key";
        return {
          signingKeyId: selectedKeyId,
          ...(signingSecretsByKeyId[selectedKeyId]
            ? { eventSigningSecret: signingSecretsByKeyId[selectedKeyId] }
            : {})
        };
      })(),
      serviceName: "ingress-service",
      serviceVersion: env.SERVICE_VERSION ?? "0.1.0",
      environment: profile,
      host: env.SERVICE_HOST ?? "0.0.0.0",
      port: Number(env.SERVICE_PORT ?? 4101),
      logLevel: env.LOG_LEVEL ?? "info",
      humanReadableLogs: env.HUMAN_LOGS === "true",
      channelSignatureRequired: env.CHANNEL_SIGNATURE_REQUIRED !== "false",
      eventBusPublishTimeoutMs: Number(env.EVENT_BUS_PUBLISH_TIMEOUT_MS ?? 30000),
      eventBusTargetUrls: (env.EVENT_BUS_TARGET_URLS ?? "http://localhost:4102/internal/events")
        .split(",")
        .map((value) => value.trim())
        .filter((value) => value.length > 0),
      internalAuthIssuer: env.INTERNAL_AUTH_ISSUER ?? "manasvi.internal.auth",
      internalAuthAudience: env.INTERNAL_AUTH_AUDIENCE ?? "manasvi.internal.services",
      internalAuthKeyId: await secrets.require("INTERNAL_AUTH_KEY_ID"),
      internalAuthSigningSecret: await secrets.require("INTERNAL_AUTH_SIGNING_SECRET"),
      internalAuthTokenTtlSeconds: Number(env.INTERNAL_AUTH_TOKEN_TTL_SECONDS ?? 120),
      orchestratorBaseUrl: env.ORCHESTRATOR_BASE_URL ?? "http://localhost:4102",
      webUiAdapterRequireAuth: env.WEBUI_ADAPTER_REQUIRE_AUTH !== "false",
      ingressRateLimitWindowMs: Number(env.INGRESS_RATE_LIMIT_WINDOW_MS ?? 60000),
      ingressRateLimitMaxPerSource: Number(env.INGRESS_RATE_LIMIT_MAX_PER_SOURCE ?? 60),
      ingressAntiSpamDuplicateTtlMs: Number(env.INGRESS_ANTI_SPAM_DUPLICATE_TTL_MS ?? 10000),
      genericWebhookSharedSecret: await secrets.optional("GENERIC_WEBHOOK_SHARED_SECRET"),
      telegramBotToken: await secrets.optional("TELEGRAM_BOT_TOKEN"),
      telegramWebhookSecret: await secrets.optional("TELEGRAM_WEBHOOK_SECRET"),
      telegramApiBaseUrl: env.TELEGRAM_API_BASE_URL ?? "https://api.telegram.org",
      telegramAdapterMode: (env.TELEGRAM_ADAPTER_MODE as "polling" | "webhook" | "disabled" | undefined) ?? "polling",
      telegramPollingTimeoutSeconds: Number(env.TELEGRAM_POLLING_TIMEOUT_SECONDS ?? 25),
      replyPollTimeoutMs: Number(env.REPLY_POLL_TIMEOUT_MS ?? env.TELEGRAM_POLL_TIMEOUT_MS ?? 12000),
      replyPollIntervalMs: Number(env.REPLY_POLL_INTERVAL_MS ?? env.TELEGRAM_POLL_INTERVAL_MS ?? 300),
      slackSigningSecret: await secrets.optional("SLACK_SIGNING_SECRET"),
      slackBotToken: await secrets.optional("SLACK_BOT_TOKEN")
    })
  });
}
