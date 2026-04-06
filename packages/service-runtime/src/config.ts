import type { EnvironmentProfile, ServiceName } from "@manasvi/contracts";
import { z } from "zod";

import { createSecretAccessor, createSecretProvider, type SecretAccessor } from "./secrets.js";

const envProfileSchema = z.enum(["local", "dev", "test", "staging", "production"]);
const logLevelSchema = z.enum(["debug", "info", "warn", "error"]);
const serviceNameSchema = z.enum([
  "ingress-service",
  "orchestrator-service",
  "policy-service",
  "execution-manager",
  "memory-service",
  "node-manager",
  "audit-service",
  "api-gateway"
]);

export const baseServiceConfigSchema = z.object({
  serviceName: serviceNameSchema,
  serviceVersion: z.string().min(1),
  environment: envProfileSchema,
  host: z.string().min(1).default("0.0.0.0"),
  port: z.number().int().min(1).max(65535),
  logLevel: logLevelSchema.default("info"),
  humanReadableLogs: z.boolean().default(false)
});

export type BaseServiceConfig = z.infer<typeof baseServiceConfigSchema>;

export interface ConfigLoadContext {
  env: NodeJS.ProcessEnv;
  profile: EnvironmentProfile;
  secrets: SecretAccessor;
}

export interface ValidatedConfigLoaderOptions<TSchema extends z.ZodTypeAny> {
  serviceName: ServiceName;
  schema: TSchema;
  buildConfig: (context: ConfigLoadContext) => Promise<unknown> | unknown;
}

export function resolveEnvironmentProfile(value: string | undefined): EnvironmentProfile {
  return envProfileSchema.parse(value ?? "local");
}

export async function loadValidatedConfig<TSchema extends z.ZodTypeAny>(
  options: ValidatedConfigLoaderOptions<TSchema>,
  env: NodeJS.ProcessEnv = process.env
): Promise<z.output<TSchema>> {
  const profile = resolveEnvironmentProfile(env.MANASVI_ENV);
  const provider = createSecretProvider(env);
  const secrets = createSecretAccessor(provider);
  const rawConfig = await options.buildConfig({ env, profile, secrets });
  const parsed = options.schema.safeParse(rawConfig);
  if (!parsed.success) {
    const errors = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid configuration for ${options.serviceName}: ${errors}`);
  }
  return parsed.data;
}
