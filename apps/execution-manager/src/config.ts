import { z } from "zod";

import { baseServiceConfigSchema, loadValidatedConfig } from "@manasvi/service-runtime";

export const executionConfigSchema = baseServiceConfigSchema.extend({
  serviceName: z.literal("execution-manager"),
  port: z.number().int().min(1).max(65535).default(4104),
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
      sandboxProfileDefault: env.SANDBOX_PROFILE_DEFAULT ?? "read_only",
      executionControlToken:
        profile === "staging" || profile === "production"
          ? await secrets.require("EXECUTION_CONTROL_TOKEN")
          : await secrets.optional("EXECUTION_CONTROL_TOKEN")
    })
  });
}

