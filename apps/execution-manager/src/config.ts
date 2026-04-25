import { z } from "zod";

import { baseServiceConfigSchema, loadValidatedConfig } from "@manasvi/service-runtime";
import { egressWhitelistPolicySchema } from "@manasvi/contracts";

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
  approvalVerificationKeys: z.record(z.string().min(1)).refine((value) => Object.keys(value).length > 0, {
    message: "At least one approval verification key is required"
  }),
  executionTokenTtlSeconds: z.number().int().positive().max(600).default(90),
  sandboxRootDir: z.string().min(1).default("/tmp/manasvi-runs"),
  sandboxMaxOutputBytes: z.number().int().positive().max(512 * 1024).default(64 * 1024),
  allowIncomingRawSecretValues: z.boolean().default(false),
  secretRefEnvMapJson: z.string().default("{}"),
  auditServiceBaseUrl: z.string().url().default("http://localhost:4107"),
  egressWhitelistPolicy: egressWhitelistPolicySchema,
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
      ...(function () {
        const egressPolicyRaw =
          env.EXECUTION_EGRESS_WHITELIST_POLICY_JSON ??
          JSON.stringify({
            schemaVersion: "1.0",
            policyId: "egress:local-default-deny",
            description: "Default deny egress policy for local runtime",
            rules: []
          });
        let parsed: unknown;
        try {
          parsed = JSON.parse(egressPolicyRaw);
        } catch (error) {
          throw new Error(
            `Invalid EXECUTION_EGRESS_WHITELIST_POLICY_JSON: ${
              error instanceof Error ? error.message : "unknown parse error"
            }`
          );
        }
        return {
          egressWhitelistPolicy: egressWhitelistPolicySchema.parse(parsed)
        };
      })(),
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
      approvalVerificationKeys: (await secrets.require("APPROVAL_VERIFICATION_KEYS"))
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
      executionTokenTtlSeconds: Number(env.EXECUTION_TOKEN_TTL_SECONDS ?? 90),
      sandboxRootDir: env.SANDBOX_ROOT_DIR ?? "/tmp/manasvi-runs",
      sandboxMaxOutputBytes: Number(env.SANDBOX_MAX_OUTPUT_BYTES ?? 64 * 1024),
      allowIncomingRawSecretValues: env.EXECUTION_ALLOW_INCOMING_RAW_SECRET_VALUES === "true",
      secretRefEnvMapJson: env.SECRET_REF_ENV_MAP_JSON ?? "{}",
      auditServiceBaseUrl: env.AUDIT_SERVICE_BASE_URL ?? "http://localhost:4107",
      sandboxProfileDefault: env.SANDBOX_PROFILE_DEFAULT ?? "read_only",
      executionControlToken:
        profile === "staging" || profile === "production"
          ? await secrets.require("EXECUTION_CONTROL_TOKEN")
          : await secrets.optional("EXECUTION_CONTROL_TOKEN")
    })
  });
}
