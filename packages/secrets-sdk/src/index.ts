import {
  createPolicyEvaluationRequest,
  createSecretAccessGrant,
  createSecretAccessRequest,
  secretReferenceStringSchema,
  secretUsageRecordSchema,
  type PolicyTrace,
  type ResolvedPrincipalContext,
  type SecretAccessGrant,
  type SecretReferenceString,
  type SecretUsageRecord
} from "@manasvi/contracts";
import { type PolicyClient } from "@manasvi/policy-sdk";

export interface SecretMetadata {
  reference: SecretReferenceString;
  provider: string;
  category: string;
  sensitivity: "standard" | "high" | "critical";
  version?: string;
  rotatedAt?: string;
  updatedAt?: string;
}

export interface SecretProvider {
  readonly name: string;
  resolveMetadata(reference: SecretReferenceString): Promise<SecretMetadata | undefined>;
  getSecretValue(reference: SecretReferenceString): Promise<string | undefined>;
}

export interface SecretBrokerAccessInput {
  principalContext: ResolvedPrincipalContext;
  trace: PolicyTrace;
  tenantId: string;
  workspaceId: string;
  consumerType:
    | "adapter-runtime"
    | "tool-runtime"
    | "plugin-runtime"
    | "node-runtime"
    | "execution-manager"
    | "orchestrator"
    | "service-config";
  consumerId: string;
  purpose: string;
  references: SecretReferenceString[];
  requestRawExposure?: boolean;
  allowRawExposureForConsumer?: boolean;
  runtimeContext?: {
    sandboxMode?: string;
    nodeId?: string;
    pluginId?: string;
    toolId?: string;
  };
}

export interface SecretResolution {
  grants: SecretAccessGrant[];
  secretValuesByRef: Record<string, string>;
  usageRecords: SecretUsageRecord[];
}

function normalizeEnvKey(reference: string): string {
  return `MANASVI_SECRET_REF_${reference.replace(/[^A-Za-z0-9_]/g, "_").toUpperCase()}`;
}

export class EnvMapSecretProvider implements SecretProvider {
  readonly name = "env-map";

  constructor(
    private readonly env: NodeJS.ProcessEnv,
    private readonly referenceToEnvKey: Record<string, string> = {}
  ) {}

  async resolveMetadata(reference: SecretReferenceString): Promise<SecretMetadata | undefined> {
    const envKey = this.referenceToEnvKey[reference] ?? normalizeEnvKey(reference);
    const hasValue = Boolean(this.env[envKey] && this.env[envKey]!.length > 0);
    if (!hasValue) {
      return undefined;
    }
    const metadata: SecretMetadata = {
      reference,
      provider: this.name,
      category: "runtime_secret",
      sensitivity: "high"
    };
    const version = this.env[`${envKey}_VERSION`];
    const rotatedAt = this.env[`${envKey}_ROTATED_AT`];
    const updatedAt = this.env[`${envKey}_UPDATED_AT`];
    if (version) {
      metadata.version = version;
    }
    if (rotatedAt) {
      metadata.rotatedAt = rotatedAt;
    }
    if (updatedAt) {
      metadata.updatedAt = updatedAt;
    }
    return metadata;
  }

  async getSecretValue(reference: SecretReferenceString): Promise<string | undefined> {
    const envKey = this.referenceToEnvKey[reference] ?? normalizeEnvKey(reference);
    const value = this.env[envKey];
    return value && value.length > 0 ? value : undefined;
  }
}

export interface SecretBrokerOptions {
  policyClient: PolicyClient;
  provider: SecretProvider;
  requestingService: {
    principalId: string;
    principalType: "service";
  };
  onUsageRecord?: (record: SecretUsageRecord) => void | Promise<void>;
}

export class SecretBroker {
  constructor(private readonly options: SecretBrokerOptions) {}

  async resolveForRuntime(input: SecretBrokerAccessInput): Promise<SecretResolution> {
    const refs = input.references.map((ref) => secretReferenceStringSchema.parse(ref));
    const requestRaw = input.requestRawExposure ?? false;
    const usageRecords: SecretUsageRecord[] = [];

    if (requestRaw && !input.allowRawExposureForConsumer) {
      const deniedRecords = refs.map((reference) =>
        secretUsageRecordSchema.parse({
          schemaVersion: "1.0",
          usageId: `usage:${Date.now()}:${Math.random().toString(16).slice(2, 8)}`,
          eventType: "secret.exposure.blocked",
          timestamp: new Date().toISOString(),
          reference,
          consumerType: input.consumerType,
          consumerId: input.consumerId,
          actor: input.principalContext.actor,
          caller: input.principalContext.caller,
          tenantId: input.tenantId,
          workspaceId: input.workspaceId,
          trace: input.trace,
          reasonCodes: ["RAW_SECRET_EXPOSURE_DISABLED_FOR_CONSUMER"]
        })
      );
      await this.emitUsageRecords(deniedRecords);
      throw new Error("RAW_SECRET_EXPOSURE_DISABLED_FOR_CONSUMER");
    }

    const grants: SecretAccessGrant[] = [];
    const secretValuesByRef: Record<string, string> = {};

    for (const reference of refs) {
      const accessRequest = createSecretAccessRequest({
        reference,
        consumerType: input.consumerType,
        consumerId: input.consumerId,
        purpose: input.purpose,
        actor: input.principalContext.actor,
        caller: input.principalContext.caller,
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        trace: input.trace,
        rawValueExposureRequested: requestRaw,
        runtimeContext: input.runtimeContext ?? {}
      });

      usageRecords.push(
        secretUsageRecordSchema.parse({
          schemaVersion: "1.0",
          usageId: `usage:${accessRequest.requestId}:requested`,
          eventType: "secret.access.requested",
          timestamp: accessRequest.requestedAt,
          reference,
          consumerType: input.consumerType,
          consumerId: input.consumerId,
          actor: input.principalContext.actor,
          caller: input.principalContext.caller,
          tenantId: input.tenantId,
          workspaceId: input.workspaceId,
          trace: input.trace,
          reasonCodes: [],
          metadata: {
            purpose: input.purpose
          }
        })
      );

      const decision = await this.options.policyClient.evaluate(
        createPolicyEvaluationRequest({
          requestingService: this.options.requestingService,
          principalContext: input.principalContext,
          action: {
            actionClass: "access-secret",
            actionId: `secret.access.${input.consumerType}`,
            attributes: {
              purpose: input.purpose,
              consumerType: input.consumerType,
              consumerId: input.consumerId,
              ...(input.runtimeContext ?? {})
            }
          },
          resource: {
            resourceClass: "secret-reference",
            resourceId: reference,
            tenantId: input.tenantId,
            workspaceId: input.workspaceId,
            attributes: {}
          },
          requestedCapabilities: [
            {
              capabilityId: "secret.read",
              scope: {
                tenantId: input.tenantId,
                workspaceId: input.workspaceId,
                resourceClass: "secret-reference",
                resourcePattern: reference
              },
              constraints: {
                consumerType: input.consumerType
              }
            }
          ],
          tenantId: input.tenantId,
          workspaceId: input.workspaceId,
          approval: {
            approvalPresent: false,
            skipApprovalRequested: false
          },
          risk: {
            flags: [
              `secret_consumer:${input.consumerType}`,
              ...(input.consumerType === "plugin-runtime" ? ["plugin_secret_access"] : []),
              ...(input.consumerType === "orchestrator" ? ["orchestrator_secret_access"] : [])
            ],
            requireExplicitRiskPolicy: true
          },
          environment: {
            attributes: {}
          },
          trace: input.trace
        })
      );

      const grant = createSecretAccessGrant({
        requestId: accessRequest.requestId,
        reference,
        approved: decision.decision === "ALLOW" || decision.decision === "CONDITIONAL_ALLOW",
        trace: input.trace,
        policyDecisionId: decision.decisionId,
        policyAuditRecordId: decision.auditRecordId,
        reasonCodes: decision.reasonCodes,
        rawValueExposureAllowed: requestRaw && Boolean(input.allowRawExposureForConsumer)
      });

      grants.push(grant);
      usageRecords.push(
        secretUsageRecordSchema.parse({
          schemaVersion: "1.0",
          usageId: `usage:${accessRequest.requestId}:${grant.approved ? "approved" : "denied"}`,
          eventType: grant.approved ? "secret.access.approved" : "secret.access.denied",
          timestamp: new Date().toISOString(),
          reference,
          consumerType: input.consumerType,
          consumerId: input.consumerId,
          actor: input.principalContext.actor,
          caller: input.principalContext.caller,
          tenantId: input.tenantId,
          workspaceId: input.workspaceId,
          trace: input.trace,
          policyDecisionId: decision.decisionId,
          reasonCodes: decision.reasonCodes
        })
      );

      if (!grant.approved) {
        await this.emitUsageRecords(usageRecords);
        throw new Error(`SECRET_ACCESS_DENIED:${reference}`);
      }

      const metadata = await this.options.provider.resolveMetadata(reference);
      if (!metadata) {
        usageRecords.push(
          secretUsageRecordSchema.parse({
            schemaVersion: "1.0",
            usageId: `usage:${accessRequest.requestId}:provider-miss`,
            eventType: "secret.provider.lookup_failed",
            timestamp: new Date().toISOString(),
            reference,
            consumerType: input.consumerType,
            consumerId: input.consumerId,
            actor: input.principalContext.actor,
            caller: input.principalContext.caller,
            tenantId: input.tenantId,
            workspaceId: input.workspaceId,
            trace: input.trace,
            reasonCodes: ["SECRET_REFERENCE_NOT_FOUND"]
          })
        );
        await this.emitUsageRecords(usageRecords);
        throw new Error(`SECRET_REFERENCE_NOT_FOUND:${reference}`);
      }
      const value = await this.options.provider.getSecretValue(reference);
      if (!value) {
        usageRecords.push(
          secretUsageRecordSchema.parse({
            schemaVersion: "1.0",
            usageId: `usage:${accessRequest.requestId}:provider-empty`,
            eventType: "secret.provider.lookup_failed",
            timestamp: new Date().toISOString(),
            reference,
            consumerType: input.consumerType,
            consumerId: input.consumerId,
            actor: input.principalContext.actor,
            caller: input.principalContext.caller,
            tenantId: input.tenantId,
            workspaceId: input.workspaceId,
            trace: input.trace,
            reasonCodes: ["SECRET_VALUE_UNAVAILABLE"]
          })
        );
        await this.emitUsageRecords(usageRecords);
        throw new Error(`SECRET_VALUE_UNAVAILABLE:${reference}`);
      }

      secretValuesByRef[reference] = value;
      usageRecords.push(
        secretUsageRecordSchema.parse({
          schemaVersion: "1.0",
          usageId: `usage:${accessRequest.requestId}:resolved`,
          eventType: "secret.resolved",
          timestamp: new Date().toISOString(),
          reference,
          consumerType: input.consumerType,
          consumerId: input.consumerId,
          actor: input.principalContext.actor,
          caller: input.principalContext.caller,
          tenantId: input.tenantId,
          workspaceId: input.workspaceId,
          trace: input.trace,
          policyDecisionId: decision.decisionId,
          reasonCodes: [],
          metadata: {
            provider: metadata.provider,
            category: metadata.category,
            sensitivity: metadata.sensitivity,
            ...(metadata.version ? { version: metadata.version } : {})
          }
        })
      );
      usageRecords.push(
        secretUsageRecordSchema.parse({
          schemaVersion: "1.0",
          usageId: `usage:${accessRequest.requestId}:injected`,
          eventType: "secret.injected",
          timestamp: new Date().toISOString(),
          reference,
          consumerType: input.consumerType,
          consumerId: input.consumerId,
          actor: input.principalContext.actor,
          caller: input.principalContext.caller,
          tenantId: input.tenantId,
          workspaceId: input.workspaceId,
          trace: input.trace,
          policyDecisionId: decision.decisionId,
          reasonCodes: [],
          metadata: {
            purpose: input.purpose
          }
        })
      );
    }

    await this.emitUsageRecords(usageRecords);
    return {
      grants,
      secretValuesByRef,
      usageRecords
    };
  }

  private async emitUsageRecords(records: SecretUsageRecord[]): Promise<void> {
    if (!this.options.onUsageRecord) {
      return;
    }
    for (const record of records) {
      await this.options.onUsageRecord(record);
    }
  }
}

export function parseSecretReferenceMapping(raw: string | undefined): Record<string, string> {
  if (!raw || raw.trim().length === 0) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return Object.entries(parsed).reduce<Record<string, string>>((acc, [key, value]) => {
      if (typeof value === "string" && value.length > 0) {
        acc[key] = value;
      }
      return acc;
    }, {});
  } catch {
    return {};
  }
}

export function redactSecretsInObject(input: Record<string, unknown>): Record<string, unknown> {
  const redactKey = (k: string) => /(secret|token|password|credential|api.?key)/i.test(k);
  const walk = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map((v) => walk(v));
    if (value && typeof value === "object") {
      return Object.entries(value as Record<string, unknown>).reduce<Record<string, unknown>>((acc, [k, v]) => {
        acc[k] = redactKey(k) ? "[REDACTED]" : walk(v);
        return acc;
      }, {});
    }
    return value;
  };
  return walk(input) as Record<string, unknown>;
}
