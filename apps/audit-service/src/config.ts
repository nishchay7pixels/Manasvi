import { z } from "zod";

import { baseServiceConfigSchema, loadValidatedConfig } from "@manasvi/service-runtime";

export const auditConfigSchema = baseServiceConfigSchema.extend({
  serviceName: z.literal("audit-service"),
  port: z.number().int().min(1).max(65535).default(4107),
  appendOnlyMode: z.boolean().default(true),
  storageFilePath: z.string().min(1).default("/tmp/manasvi/audit/audit-events.jsonl"),
  defaultRiskWindowMinutes: z.number().int().positive().max(1440).default(60),
  /** HMAC key for signing integrity metadata. Optional in local/dev; required in staging/production. */
  auditIntegrityKey: z.string().min(1).optional()
});

export type AuditServiceConfig = z.infer<typeof auditConfigSchema>;

export async function loadAuditServiceConfig(): Promise<AuditServiceConfig> {
  return loadValidatedConfig({
    serviceName: "audit-service",
    schema: auditConfigSchema,
    buildConfig: async ({ env, profile, secrets }) => ({
      serviceName: "audit-service",
      serviceVersion: env.SERVICE_VERSION ?? "0.1.0",
      environment: profile,
      host: env.SERVICE_HOST ?? "0.0.0.0",
      port: Number(env.SERVICE_PORT ?? 4107),
      logLevel: env.LOG_LEVEL ?? "info",
      humanReadableLogs: env.HUMAN_LOGS === "true",
      appendOnlyMode: env.AUDIT_APPEND_ONLY_MODE !== "false",
      storageFilePath: env.AUDIT_STORAGE_FILE_PATH ?? "/tmp/manasvi/audit/audit-events.jsonl",
      defaultRiskWindowMinutes: Number(env.AUDIT_DEFAULT_RISK_WINDOW_MINUTES ?? 60),
      auditIntegrityKey:
        profile === "staging" || profile === "production"
          ? await secrets.require("AUDIT_INTEGRITY_KEY")
          : await secrets.optional("AUDIT_INTEGRITY_KEY")
    })
  });
}
