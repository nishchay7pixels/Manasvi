import { randomUUID } from "node:crypto";
import { z } from "zod";

import { CONTRACT_SCHEMA_VERSION, trustClassSchema } from "./base.js";
import { approvedIntentArtifactSchema, executionIntentSchema } from "./execution-intent.js";
import { principalReferenceSchema } from "./identity.js";
import { actionClassSchema, policyResourceReferenceSchema, policyTraceSchema } from "./policy.js";
import { secretReferenceStringSchema } from "./secrets.js";

export const TOOL_CONTRACT_VERSION = "1.0" as const;

export const toolTypeSchema = z.enum([
  "built_in",
  "adapter",
  "workflow",
  "integration",
  "operator_controlled"
]);
export type ToolType = z.infer<typeof toolTypeSchema>;

export const toolActionClassSchema = z.enum([
  "read",
  "write",
  "execute",
  "fetch",
  "search",
  "register",
  "approve",
  "mutate-memory",
  "access-filesystem",
  "access-network",
  "access-secret",
  "external-side-effect"
]);
export type ToolActionClass = z.infer<typeof toolActionClassSchema>;

export const toolSideEffectClassSchema = z.enum([
  "read_only",
  "mutating",
  "privileged",
  "external_side_effect",
  "secret_adjacent",
  "approval_sensitive"
]);
export type ToolSideEffectClass = z.infer<typeof toolSideEffectClassSchema>;

export const toolRuntimeProfileSchema = z.enum([
  "read_only_local",
  "restricted_remote",
  "no_network_compute",
  "privileged_operator_approved"
]);
export type ToolRuntimeProfile = z.infer<typeof toolRuntimeProfileSchema>;

export const toolLifecycleStatusSchema = z.enum(["registered", "enabled", "disabled", "deprecated"]);
export type ToolLifecycleStatus = z.infer<typeof toolLifecycleStatusSchema>;

export interface JsonSchemaShape {
  type?: string | undefined;
  description?: string | undefined;
  enum?: unknown[] | undefined;
  items?: JsonSchemaShape | undefined;
  required?: string[] | undefined;
  properties?: Record<string, JsonSchemaShape> | undefined;
  additionalProperties?: boolean | JsonSchemaShape | undefined;
}

export const jsonSchemaShapeSchema: z.ZodType<JsonSchemaShape> = z.lazy(() =>
  z.object({
    type: z.string().min(1).optional(),
    description: z.string().min(1).optional(),
    enum: z.array(z.unknown()).optional(),
    items: jsonSchemaShapeSchema.optional(),
    required: z.array(z.string().min(1)).optional(),
    properties: z.record(jsonSchemaShapeSchema).optional(),
    additionalProperties: z.union([z.boolean(), jsonSchemaShapeSchema]).optional()
  })
);

export const toolCapabilityDeclarationSchema = z.object({
  capabilityId: z.string().min(1),
  required: z.boolean().default(true),
  scope: z.object({
    tenantScoped: z.boolean().default(true),
    workspaceScoped: z.boolean().default(true),
    resourceClass: z.string().min(1).optional(),
    resourcePattern: z.string().min(1).optional()
  }),
  constraints: z.record(z.unknown()).default({})
});
export type ToolCapabilityDeclaration = z.infer<typeof toolCapabilityDeclarationSchema>;

export const toolPolicyBindingSchema = z.object({
  policyActionClass: actionClassSchema,
  resource: policyResourceReferenceSchema.pick({
    resourceClass: true,
    resourceId: true
  }),
  requiresExplicitPolicy: z.boolean().default(true),
  approvalHint: z.enum(["none", "may_require", "must_require"]).default("may_require")
});
export type ToolPolicyBinding = z.infer<typeof toolPolicyBindingSchema>;

export const toolRuntimeHintsSchema = z.object({
  defaultTimeoutMs: z.number().int().positive().max(300000).default(12000),
  defaultSandboxMode: toolRuntimeProfileSchema.default("read_only_local"),
  egressProfiles: z.array(z.string().min(1)).default([]),
  filesystemProfile: z.enum(["none", "read_only_inputs", "scratch_write", "privileged_bounded"]).default("none"),
  declaredSecretRefs: z.array(secretReferenceStringSchema).default([]),
  requireExecutorPath: z.boolean().default(true),
  approvalSensitive: z.boolean().default(false)
});
export type ToolRuntimeHints = z.infer<typeof toolRuntimeHintsSchema>;

export const toolRuntimeBindingSchema = z.object({
  toolRef: z.string().min(1),
  operation: z.string().min(1)
});
export type ToolRuntimeBinding = z.infer<typeof toolRuntimeBindingSchema>;

export const toolManifestSchema = z.object({
  schemaVersion: z.literal(TOOL_CONTRACT_VERSION),
  contractVersion: z.literal(CONTRACT_SCHEMA_VERSION),
  toolId: z.string().min(1),
  name: z.string().min(1),
  version: z.string().min(1),
  description: z.string().min(1),
  owner: z.string().min(1),
  provider: z.string().min(1),
  type: toolTypeSchema,
  actionClass: toolActionClassSchema,
  sideEffectClass: toolSideEffectClassSchema,
  mutability: z.enum(["read_only", "mutating"]),
  capabilities: z.array(toolCapabilityDeclarationSchema).min(1),
  resourceClassesTouched: z.array(z.string().min(1)).min(1),
  inputSchema: jsonSchemaShapeSchema,
  outputSchema: jsonSchemaShapeSchema,
  runtimeHints: toolRuntimeHintsSchema,
  runtimeBinding: toolRuntimeBindingSchema,
  policyBinding: toolPolicyBindingSchema,
  trustNotes: z.array(z.string().min(1)).default([]),
  tags: z.array(z.string().min(1)).default([]),
  status: z.enum(["enabled", "disabled", "deprecated"]).default("enabled"),
  deprecatedAt: z.string().datetime({ offset: true }).optional(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true })
});
export type ToolManifest = z.infer<typeof toolManifestSchema>;

export const toolRegistryEntrySchema = z.object({
  schemaVersion: z.literal(TOOL_CONTRACT_VERSION),
  toolId: z.string().min(1),
  version: z.string().min(1),
  status: toolLifecycleStatusSchema,
  registeredBy: principalReferenceSchema,
  registeredAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
  manifest: toolManifestSchema
});
export type ToolRegistryEntry = z.infer<typeof toolRegistryEntrySchema>;

export const toolInvocationRequestSchema = z.object({
  schemaVersion: z.literal(TOOL_CONTRACT_VERSION),
  invocationId: z.string().min(1),
  toolId: z.string().min(1),
  toolVersion: z.string().min(1).optional(),
  tenantId: z.string().min(1),
  workspaceId: z.string().min(1),
  actor: principalReferenceSchema,
  caller: principalReferenceSchema,
  sessionId: z.string().min(1).optional(),
  input: z.record(z.unknown()),
  requestedSecretRefs: z.array(secretReferenceStringSchema).default([]),
  trace: policyTraceSchema
});
export type ToolInvocationRequest = z.infer<typeof toolInvocationRequestSchema>;

export const toolExecutionContractSchema = z.object({
  schemaVersion: z.literal(TOOL_CONTRACT_VERSION),
  contractId: z.string().min(1),
  invocation: toolInvocationRequestSchema,
  manifest: toolManifestSchema,
  intent: executionIntentSchema,
  artifact: approvedIntentArtifactSchema,
  trace: policyTraceSchema
});
export type ToolExecutionContract = z.infer<typeof toolExecutionContractSchema>;

export const toolResultSchema = z.object({
  schemaVersion: z.literal(TOOL_CONTRACT_VERSION),
  invocationId: z.string().min(1),
  toolId: z.string().min(1),
  toolVersion: z.string().min(1),
  status: z.enum(["completed", "failed", "validation_failed", "policy_denied"]),
  output: z.record(z.unknown()).default({}),
  error: z
    .object({
      code: z.string().min(1),
      message: z.string().min(1)
    })
    .optional(),
  provenance: z.object({
    source: z.string().min(1),
    trustClassification: trustClassSchema,
    externalSourceRef: z.string().min(1).optional()
  }),
  runtime: z.object({
    runId: z.string().min(1).optional(),
    executionArtifactId: z.string().min(1).optional(),
    durationMs: z.number().int().nonnegative().optional()
  }),
  trace: policyTraceSchema
});
export type ToolResult = z.infer<typeof toolResultSchema>;

export function createToolInvocationRequest(
  input: Omit<ToolInvocationRequest, "schemaVersion" | "invocationId">
): ToolInvocationRequest {
  return toolInvocationRequestSchema.parse({
    schemaVersion: TOOL_CONTRACT_VERSION,
    invocationId: `tool-invocation:${randomUUID()}`,
    ...input
  });
}

export function createToolExecutionContract(input: {
  invocation: ToolInvocationRequest;
  manifest: ToolManifest;
  intent: z.infer<typeof executionIntentSchema>;
  artifact: z.infer<typeof approvedIntentArtifactSchema>;
  trace: z.infer<typeof policyTraceSchema>;
}): ToolExecutionContract {
  return toolExecutionContractSchema.parse({
    schemaVersion: TOOL_CONTRACT_VERSION,
    contractId: `tool-contract:${randomUUID()}`,
    invocation: input.invocation,
    manifest: input.manifest,
    intent: input.intent,
    artifact: input.artifact,
    trace: input.trace
  });
}
