import type { EnvironmentProfile, ServiceName } from "@manasvi/contracts";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { z } from "zod";

import { createSecretAccessor, createSecretProvider, type SecretAccessor } from "./secrets.js";

const envProfileSchema = z.enum(["local", "dev", "test", "staging", "production"]);
const logLevelSchema = z.enum(["debug", "info", "warn", "error"]);
const serviceNameSchema = z.enum([
  "ingress-service",
  "orchestrator-service",
  "policy-service",
  "approval-service",
  "execution-manager",
  "memory-service",
  "node-manager",
  "node-agent",
  "audit-service",
  "api-gateway",
  "extension-runtime"
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

function parseDotEnv(contents: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) {
      continue;
    }
    const separator = line.indexOf("=");
    if (separator <= 0) {
      continue;
    }
    const key = line.slice(0, separator).trim();
    if (!key) {
      continue;
    }
    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

function findWorkspaceRoot(start: string): string | undefined {
  let current = resolve(start);
  while (true) {
    if (existsSync(join(current, "pnpm-workspace.yaml"))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) {
      return undefined;
    }
    current = parent;
  }
}

function loadDotEnvFiles(env: NodeJS.ProcessEnv, startDir: string): void {
  const workspaceRoot = findWorkspaceRoot(startDir);
  const candidateFiles = [
    join(startDir, ".env"),
    join(startDir, ".env.local"),
    ...(workspaceRoot
      ? [join(workspaceRoot, ".env"), join(workspaceRoot, ".env.local")]
      : [])
  ];
  for (const filePath of candidateFiles) {
    if (!existsSync(filePath)) {
      continue;
    }
    const parsed = parseDotEnv(readFileSync(filePath, "utf8"));
    for (const [key, value] of Object.entries(parsed)) {
      if (env[key] === undefined || env[key] === "") {
        env[key] = value;
      }
    }
  }
}

export async function loadValidatedConfig<TSchema extends z.ZodTypeAny>(
  options: ValidatedConfigLoaderOptions<TSchema>,
  env: NodeJS.ProcessEnv = process.env
): Promise<z.output<TSchema>> {
  loadDotEnvFiles(env, process.cwd());
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
