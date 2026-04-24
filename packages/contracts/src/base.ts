import { z } from "zod";

export const CONTRACT_SCHEMA_VERSION = "1.0.0" as const;
export const EVENT_ENVELOPE_VERSION = "1.0" as const;

export type EnvironmentProfile =
  | "local"
  | "dev"
  | "test"
  | "staging"
  | "production";

export type ServiceName =
  | "ingress-service"
  | "orchestrator-service"
  | "policy-service"
  | "approval-service"
  | "execution-manager"
  | "memory-service"
  | "node-manager"
  | "audit-service"
  | "api-gateway"
  | "extension-runtime";

export const serviceNameSchema = z.enum([
  "ingress-service",
  "orchestrator-service",
  "policy-service",
  "approval-service",
  "execution-manager",
  "memory-service",
  "node-manager",
  "audit-service",
  "api-gateway",
  "extension-runtime"
]);

export type ReadinessStatus = "ready" | "not_ready";

export interface ServiceMetadata {
  schemaVersion: typeof CONTRACT_SCHEMA_VERSION;
  serviceName: ServiceName;
  serviceVersion: string;
  environment: EnvironmentProfile;
  startedAt: string;
}

export interface TraceMetadata {
  traceId: string;
  correlationId: string;
  parentTraceId?: string;
}

export interface HealthResponse {
  schemaVersion: typeof CONTRACT_SCHEMA_VERSION;
  status: "ok";
  metadata: ServiceMetadata;
  trace: TraceMetadata;
  timestamp: string;
}

export interface ReadinessCheckResult {
  name: string;
  status: ReadinessStatus;
  detail?: string;
}

export interface ReadinessResponse {
  schemaVersion: typeof CONTRACT_SCHEMA_VERSION;
  status: ReadinessStatus;
  metadata: ServiceMetadata;
  checks: ReadinessCheckResult[];
  trace: TraceMetadata;
  timestamp: string;
}

export interface ErrorResponse {
  schemaVersion: typeof CONTRACT_SCHEMA_VERSION;
  error: {
    code: string;
    message: string;
    retryable: boolean;
  };
  trace: TraceMetadata;
  timestamp: string;
}

export type TrustClass =
  | "CONTROL_TRUSTED"
  | "USER_OWNED"
  | "EXTERNAL_UNTRUSTED"
  | "SECRET_SENSITIVE"
  | "AUDIT_SECURITY"
  | "MODEL_INTERMEDIATE";

export const trustClassSchema = z.enum([
  "CONTROL_TRUSTED",
  "USER_OWNED",
  "EXTERNAL_UNTRUSTED",
  "SECRET_SENSITIVE",
  "AUDIT_SECURITY",
  "MODEL_INTERMEDIATE"
]);
