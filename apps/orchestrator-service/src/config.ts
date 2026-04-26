import { z } from "zod";

import { baseServiceConfigSchema, loadValidatedConfig } from "@manasvi/service-runtime";

export const orchestratorConfigSchema = baseServiceConfigSchema.extend({
  serviceName: z.literal("orchestrator-service"),
  port: z.number().int().min(1).max(65535).default(4102),
  plannerModel: z.string().min(1).default("placeholder-model"),
  modelAdapterMode: z.enum(["mock", "openai", "ollama", "claude", "auto"]).default("auto"),
  modelAdapterTimeoutMs: z.number().int().positive().max(120000).default(20000),
  modelAdapterMaxContextChunks: z.number().int().positive().default(24),
  openAiApiKey: z.string().min(1).optional(),
  anthropicApiKey: z.string().min(1).optional(),
  openAiBaseUrl: z.string().url().default("https://api.openai.com/v1"),
  ollamaBaseUrl: z.string().url().default("http://localhost:11434/v1"),
  anthropicBaseUrl: z.string().url().default("https://api.anthropic.com"),
  harnessEventResultTtlSeconds: z.number().int().positive().default(900),
  requireSignedInternalEvents: z.boolean().default(true),
  maxEventHandlerAttempts: z.number().int().positive().default(5),
  eventSigningSecretsByKeyId: z.record(z.string().min(1)).default({}),
  policyServiceBaseUrl: z.string().url().default("http://localhost:4103"),
  approvalServiceBaseUrl: z.string().url().default("http://localhost:4108"),
  executionManagerBaseUrl: z.string().url().default("http://localhost:4104"),
  memoryServiceBaseUrl: z.string().url().default("http://localhost:4105"),
  executionIntentTtlSeconds: z.number().int().positive().max(86400).default(900),
  sessionDefaultIsolationMode: z.enum([
    "per_user_isolated",
    "per_channel_thread",
    "shared_collaborative",
    "ephemeral_one_shot",
    "service_internal",
    "workspace_scoped_constrained"
  ]).default("per_user_isolated"),
  sessionContextTokenBudget: z.number().int().positive().default(2048),
  sessionRecentMessageLimit: z.number().int().positive().default(20),
  agentLoopMaxIterations: z.number().int().positive().max(20).default(6),
  agentLoopMaxConsecutiveFailures: z.number().int().positive().max(10).default(2),
  agentLoopStrictPlannerParsing: z.boolean().default(true),
  internalAuthIssuer: z.string().min(1).default("manasvi.internal.auth"),
  internalAuthAudience: z.string().min(1).default("manasvi.internal.services"),
  internalAuthKeyId: z.string().min(1),
  internalAuthSigningSecret: z.string().min(1),
  internalAuthVerificationKeys: z.record(z.string().min(1)).refine((value) => Object.keys(value).length > 0, {
    message: "At least one internal auth verification key is required"
  }),
  /** HMAC-SHA256 key id used to sign execution intents at creation time. */
  intentSigningKeyId: z.string().min(1),
  /** HMAC-SHA256 secret used to sign execution intents at creation time. */
  intentSigningSecret: z.string().min(1)
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
      modelAdapterMode: env.MODEL_ADAPTER_MODE ?? "auto",
      modelAdapterTimeoutMs: Number(env.MODEL_ADAPTER_TIMEOUT_MS ?? 20000),
      modelAdapterMaxContextChunks: Number(env.MODEL_ADAPTER_MAX_CONTEXT_CHUNKS ?? 24),
      openAiApiKey:
        env.MODEL_ADAPTER_MODE === "openai"
          ? await secrets.require("OPENAI_API_KEY")
          : await secrets.optional("OPENAI_API_KEY"),
      anthropicApiKey:
        env.MODEL_ADAPTER_MODE === "claude"
          ? await secrets.require("ANTHROPIC_API_KEY")
          : await secrets.optional("ANTHROPIC_API_KEY"),
      openAiBaseUrl: env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
      ollamaBaseUrl: env.OLLAMA_BASE_URL ?? "http://localhost:11434/v1",
      anthropicBaseUrl: env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com",
      harnessEventResultTtlSeconds: Number(env.HARNESS_EVENT_RESULT_TTL_SECONDS ?? 900),
      requireSignedInternalEvents: env.REQUIRE_SIGNED_INTERNAL_EVENTS !== "false",
      maxEventHandlerAttempts: Number(env.MAX_EVENT_HANDLER_ATTEMPTS ?? 5),
      policyServiceBaseUrl: env.POLICY_SERVICE_BASE_URL ?? "http://localhost:4103",
      approvalServiceBaseUrl: env.APPROVAL_SERVICE_BASE_URL ?? "http://localhost:4108",
      executionManagerBaseUrl: env.EXECUTION_MANAGER_BASE_URL ?? "http://localhost:4104",
      memoryServiceBaseUrl: env.MEMORY_SERVICE_BASE_URL ?? "http://localhost:4105",
      executionIntentTtlSeconds: Number(env.EXECUTION_INTENT_TTL_SECONDS ?? 900),
      sessionDefaultIsolationMode: env.SESSION_DEFAULT_ISOLATION_MODE ?? "per_user_isolated",
      sessionContextTokenBudget: Number(env.SESSION_CONTEXT_TOKEN_BUDGET ?? 2048),
      sessionRecentMessageLimit: Number(env.SESSION_RECENT_MESSAGE_LIMIT ?? 20),
      agentLoopMaxIterations: Number(env.AGENT_LOOP_MAX_ITERATIONS ?? 6),
      agentLoopMaxConsecutiveFailures: Number(env.AGENT_LOOP_MAX_CONSECUTIVE_FAILURES ?? 2),
      agentLoopStrictPlannerParsing: env.AGENT_LOOP_STRICT_PLANNER_PARSING !== "false",
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
      intentSigningKeyId:
        (await secrets.optional("INTENT_SIGNING_KEY_ID")) ?? (await secrets.require("INTERNAL_AUTH_KEY_ID")),
      intentSigningSecret:
        (await secrets.optional("INTENT_SIGNING_SECRET")) ?? (await secrets.require("INTERNAL_AUTH_SIGNING_SECRET"))
    })
  });
}
