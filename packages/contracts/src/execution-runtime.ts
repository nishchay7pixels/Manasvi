import { z } from "zod";

import { CONTRACT_SCHEMA_VERSION } from "./base.js";
import { actionClassSchema, policyResourceReferenceSchema, policyTraceSchema } from "./policy.js";

export const EXECUTION_RUNTIME_CONTRACT_VERSION = "1.0" as const;

export const sandboxModeSchema = z.enum([
  "read_only_local",
  "restricted_remote",
  "no_network_compute",
  "privileged_operator_approved"
]);
export type SandboxMode = z.infer<typeof sandboxModeSchema>;

export const egressAllowlistRuleSchema = z.object({
  hostPattern: z.string().min(1),
  port: z.number().int().min(1).max(65535).optional(),
  protocol: z.enum(["http", "https", "tcp"]).default("https")
});
export type EgressAllowlistRule = z.infer<typeof egressAllowlistRuleSchema>;

export const egressWhitelistPolicySchema = z.object({
  schemaVersion: z.literal(EXECUTION_RUNTIME_CONTRACT_VERSION),
  policyId: z.string().min(1),
  description: z.string().min(1),
  rules: z.array(egressAllowlistRuleSchema).default([])
});
export type EgressWhitelistPolicy = z.infer<typeof egressWhitelistPolicySchema>;

export const filesystemPolicySchema = z.object({
  mode: z.enum(["none", "read_only_inputs", "scratch_write", "privileged_bounded"]),
  readPaths: z.array(z.string().min(1)).default([]),
  writePaths: z.array(z.string().min(1)).default([])
});
export type FilesystemPolicy = z.infer<typeof filesystemPolicySchema>;

export const networkPolicySchema = z.object({
  mode: z.enum(["none", "allowlist_only", "operator_approved"]),
  egressAllowlist: z.array(egressAllowlistRuleSchema).default([])
});
export type NetworkPolicy = z.infer<typeof networkPolicySchema>;

export const secretInjectionPolicySchema = z.object({
  allowedSecretRefs: z.array(z.string().min(1)).default([]),
  injectedSecretEnvNames: z.array(z.string().min(1)).default([])
});
export type SecretInjectionPolicy = z.infer<typeof secretInjectionPolicySchema>;

export const runtimePolicySchema = z.object({
  schemaVersion: z.literal(EXECUTION_RUNTIME_CONTRACT_VERSION),
  policyId: z.string().min(1),
  sandboxMode: sandboxModeSchema,
  timeoutMs: z.number().int().positive().max(300000),
  cpuTimeLimitSeconds: z.number().int().positive().max(300),
  memoryLimitMb: z.number().int().positive().max(8192),
  filesystem: filesystemPolicySchema,
  network: networkPolicySchema,
  secrets: secretInjectionPolicySchema,
  cleanup: z.object({
    removeWorkspaceAfterRun: z.boolean().default(true)
  }),
  derivedFrom: z.object({
    actionClass: actionClassSchema,
    target: policyResourceReferenceSchema
  })
});
export type RuntimePolicy = z.infer<typeof runtimePolicySchema>;

export const executionTokenClaimsSchema = z.object({
  runId: z.string().min(1),
  intentId: z.string().min(1),
  artifactId: z.string().min(1),
  sandboxMode: sandboxModeSchema,
  issuedAt: z.number().int().positive(),
  expiresAt: z.number().int().positive(),
  scopes: z.array(z.string().min(1)).default([])
});
export type ExecutionTokenClaims = z.infer<typeof executionTokenClaimsSchema>;

export const executorApiRequestSchema = z.object({
  schemaVersion: z.literal(EXECUTION_RUNTIME_CONTRACT_VERSION),
  runId: z.string().min(1),
  intentId: z.string().min(1),
  artifactId: z.string().min(1),
  toolRef: z.string().min(1),
  operation: z.string().min(1),
  parameters: z.record(z.unknown()).default({}),
  runtimePolicy: runtimePolicySchema,
  executionToken: z.string().min(1),
  trace: policyTraceSchema
});
export type ExecutorApiRequest = z.infer<typeof executorApiRequestSchema>;

export const executionStatusSchema = z.enum([
  "completed",
  "failed",
  "timed_out",
  "quota_exceeded",
  "policy_violation",
  "validation_failed",
  "launch_failed"
]);
export type ExecutionStatus = z.infer<typeof executionStatusSchema>;

export const executionResultArtifactSchema = z.object({
  schemaVersion: z.literal(EXECUTION_RUNTIME_CONTRACT_VERSION),
  contractVersion: z.literal(CONTRACT_SCHEMA_VERSION),
  artifactId: z.string().min(1),
  runId: z.string().min(1),
  intentId: z.string().min(1),
  approvedArtifactId: z.string().min(1),
  toolRef: z.string().min(1),
  operation: z.string().min(1),
  sandboxMode: sandboxModeSchema,
  runtimePolicyId: z.string().min(1),
  startedAt: z.string().datetime({ offset: true }),
  completedAt: z.string().datetime({ offset: true }),
  durationMs: z.number().int().nonnegative(),
  status: executionStatusSchema,
  exitCode: z.number().int().optional(),
  signal: z.string().min(1).optional(),
  timeoutAppliedMs: z.number().int().positive(),
  quotas: z.object({
    cpuTimeLimitSeconds: z.number().int().positive(),
    memoryLimitMb: z.number().int().positive()
  }),
  io: z.object({
    stdout: z.string(),
    stderr: z.string(),
    stdoutTruncated: z.boolean(),
    stderrTruncated: z.boolean()
  }),
  result: z.record(z.unknown()).default({}),
  usage: z.object({
    networkAccessed: z.boolean().default(false),
    networkDestinations: z.array(z.string().min(1)).default([]),
    filesystemWritesAttempted: z.array(z.string().min(1)).default([]),
    injectedSecrets: z.array(z.string().min(1)).default([])
  }),
  trace: policyTraceSchema,
  audit: z.object({
    decisionAuditRecordId: z.string().min(1),
    executionAuditEventId: z.string().min(1)
  }),
  failure: z.object({
    code: z.string().min(1),
    message: z.string().min(1)
  }).optional()
});
export type ExecutionResultArtifact = z.infer<typeof executionResultArtifactSchema>;

export const executionLogEventSchema = z.object({
  schemaVersion: z.literal(EXECUTION_RUNTIME_CONTRACT_VERSION),
  eventId: z.string().min(1),
  timestamp: z.string().datetime({ offset: true }),
  runId: z.string().min(1),
  intentId: z.string().min(1),
  toolRef: z.string().min(1),
  stage: z.enum([
    "execution_requested",
    "validation_passed",
    "validation_failed",
    "runtime_policy_derived",
    "sandbox_launching",
    "sandbox_started",
    "execution_completed",
    "execution_failed",
    "timeout",
    "quota_exceeded",
    "secret_injection",
    "cleanup_complete",
    "result_artifact_generated"
  ]),
  sandboxMode: sandboxModeSchema,
  trace: policyTraceSchema,
  metadata: z.record(z.unknown()).default({})
});
export type ExecutionLogEvent = z.infer<typeof executionLogEventSchema>;
