import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";

import { policyTraceSchema } from "./policy.js";
import { principalReferenceSchema } from "./identity.js";

export const PLUGIN_CONTRACT_VERSION = "1.0" as const;
export const PLUGIN_PROTOCOL_VERSION = "1.0" as const;
export const PLUGIN_API_VERSION = "1.0" as const;

// ─── Risk class ──────────────────────────────────────────────────────────────

export const pluginRiskClassSchema = z.enum(["low", "medium", "high", "privileged"]);
export type PluginRiskClass = z.infer<typeof pluginRiskClassSchema>;

// ─── Runtime type ─────────────────────────────────────────────────────────────

export const pluginRuntimeTypeSchema = z.enum(["node", "python", "binary", "container"]);
export type PluginRuntimeType = z.infer<typeof pluginRuntimeTypeSchema>;

// ─── Capability families ───────────────────────────────────────────────────────

export const pluginCapabilityFamilySchema = z.enum([
  "provide-tools",
  "provide-hooks",
  "access-network",
  "access-filesystem",
  "access-secret",
  "publish-events",
  "consume-events",
  "request-sandboxed-execution"
]);
export type PluginCapabilityFamily = z.infer<typeof pluginCapabilityFamilySchema>;

// ─── Capability request (declared in manifest) ────────────────────────────────

export const pluginCapabilityRequestSchema = z.object({
  capabilityId: z.string().min(1),
  family: pluginCapabilityFamilySchema,
  scope: z.record(z.unknown()).default({}),
  justification: z.string().min(1).optional(),
  required: z.boolean().default(true)
});
export type PluginCapabilityRequest = z.infer<typeof pluginCapabilityRequestSchema>;

// ─── Capability grant (approved subset) ──────────────────────────────────────

export const pluginCapabilityGrantSchema = z.object({
  grantId: z.string().min(1),
  capabilityId: z.string().min(1),
  family: pluginCapabilityFamilySchema,
  pluginId: z.string().min(1),
  scope: z.record(z.unknown()).default({}),
  constraints: z.record(z.unknown()).default({}),
  grantedBy: principalReferenceSchema,
  policyRef: z.string().min(1).optional(),
  grantedAt: z.string().datetime({ offset: true }),
  expiresAt: z.string().datetime({ offset: true }).optional(),
  revoked: z.boolean().default(false),
  revokedAt: z.string().datetime({ offset: true }).optional(),
  revokedReason: z.string().min(1).optional()
});
export type PluginCapabilityGrant = z.infer<typeof pluginCapabilityGrantSchema>;

// ─── Plugin tool declaration (declared in manifest) ───────────────────────────

export const pluginToolDeclarationSchema = z.object({
  toolId: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  inputSchema: z.record(z.unknown()).default({}),
  outputSchema: z.record(z.unknown()).default({}),
  sideEffects: z.array(z.string().min(1)).default([]),
  requiresApproval: z.boolean().default(false)
});
export type PluginToolDeclaration = z.infer<typeof pluginToolDeclarationSchema>;

// ─── Plugin hook declaration ──────────────────────────────────────────────────

export const pluginHookDeclarationSchema = z.object({
  hookId: z.string().min(1),
  name: z.string().min(1),
  triggerEvent: z.string().min(1),
  description: z.string().min(1).optional()
});
export type PluginHookDeclaration = z.infer<typeof pluginHookDeclarationSchema>;

// ─── Resource profile ────────────────────────────────────────────────────────

export const pluginResourceProfileSchema = z.object({
  maxMemoryMb: z.number().int().positive().default(256),
  maxCpuPercent: z.number().min(0).max(100).default(25),
  maxFileDescriptors: z.number().int().positive().default(64),
  maxLogSizeKb: z.number().int().positive().default(10240),
  healthTimeoutMs: z.number().int().positive().default(30000),
  rpcTimeoutMs: z.number().int().positive().default(10000)
});
export type PluginResourceProfile = z.infer<typeof pluginResourceProfileSchema>;

// ─── Provenance model ────────────────────────────────────────────────────────

export const pluginProvenanceSchema = z.object({
  publisher: z.string().min(1),
  publisherUrl: z.string().url().optional(),
  /**
   * SHA-256 hex digest of the plugin entrypoint artifact.
   * Computed and verified at load time. Required for non-low risk-class plugins.
   */
  artifactHash: z.string().min(1).optional(),
  /**
   * HMAC-SHA256 hex signature over the manifest JSON, produced by the publisher's key.
   * Enables manifest authenticity verification if a trusted key is registered.
   */
  signature: z.string().min(1).optional(),
  signingKeyId: z.string().min(1).optional(),
  sourceUrl: z.string().url().optional(),
  publishedAt: z.string().datetime({ offset: true }).optional()
});
export type PluginProvenance = z.infer<typeof pluginProvenanceSchema>;

// ─── Plugin manifest (the static contract) ────────────────────────────────────

export const pluginManifestSchema = z.object({
  manifestVersion: z.literal("1.0"),
  /**
   * Stable reverse-domain plugin ID. e.g. "com.example.my-plugin"
   * Must be unique across the extension plane.
   */
  pluginId: z
    .string()
    .min(3)
    .regex(
      /^[a-z0-9][a-z0-9\-\.]*[a-z0-9]$/,
      "Plugin ID must be lowercase alphanumeric with hyphens/dots"
    ),
  name: z.string().min(1),
  displayName: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  version: z.string().min(1),
  publisher: z.string().min(1),
  runtimeType: pluginRuntimeTypeSchema,
  /** Command / module path used to launch the plugin process. */
  entrypoint: z.string().min(1),
  /** Plugin API version the plugin was written against. Must be "1.0" for now. */
  supportedApiVersion: z.string().min(1).default("1.0"),

  // ── Requested surfaces ──────────────────────────────────────────────────
  requestedCapabilities: z.array(pluginCapabilityRequestSchema).default([]),
  providedTools: z.array(pluginToolDeclarationSchema).default([]),
  providedHooks: z.array(pluginHookDeclarationSchema).default([]),

  // ── Required external access (requests, not guarantees) ─────────────────
  requiredSecretRefs: z.array(z.string().min(1)).default([]),
  requiredNetworkDomains: z.array(z.string().min(1)).default([]),
  requiredFilesystemZones: z.array(z.string().min(1)).default([]),

  // ── Risk / governance ───────────────────────────────────────────────────
  riskClass: pluginRiskClassSchema,
  resourceProfile: pluginResourceProfileSchema.optional(),

  // ── Health check ────────────────────────────────────────────────────────
  healthCheck: z
    .object({
      method: z.enum(["http", "rpc", "none"]),
      path: z.string().min(1).optional(),
      intervalMs: z.number().int().positive().default(30000),
      timeoutMs: z.number().int().positive().default(5000)
    })
    .optional(),

  // ── Provenance / signing ────────────────────────────────────────────────
  provenance: pluginProvenanceSchema.optional(),

  // ── Lifecycle state ─────────────────────────────────────────────────────
  enabled: z.boolean().default(true),
  deprecationState: z.enum(["active", "deprecated", "end-of-life"]).default("active"),

  // ── Discovery metadata ──────────────────────────────────────────────────
  tags: z.array(z.string().min(1)).default([]),
  category: z.string().min(1).optional(),
  compatibleCoreVersions: z.string().min(1).optional()
});
export type PluginManifest = z.infer<typeof pluginManifestSchema>;

// ─── Plugin lifecycle states ──────────────────────────────────────────────────

export const pluginLifecycleStateSchema = z.enum([
  "discovered",
  "validated",
  "pending_approval",
  "approved",
  "denied",
  "loading",
  "running",
  "unhealthy",
  "stopped",
  "failed",
  "revoked",
  "disabled",
  "updating"
]);
export type PluginLifecycleState = z.infer<typeof pluginLifecycleStateSchema>;

// ─── Provenance verification result ──────────────────────────────────────────

export const pluginProvenanceVerificationResultSchema = z.object({
  verified: z.boolean(),
  method: z.enum(["hash-check", "signature", "none", "skipped"]),
  artifactHash: z.string().min(1).optional(),
  signatureValid: z.boolean().optional(),
  verifiedAt: z.string().datetime({ offset: true }),
  note: z.string().min(1).optional()
});
export type PluginProvenanceVerificationResult = z.infer<
  typeof pluginProvenanceVerificationResultSchema
>;

// ─── Plugin registry entry ────────────────────────────────────────────────────

export const pluginRegistryEntrySchema = z.object({
  schemaVersion: z.literal(PLUGIN_CONTRACT_VERSION),
  pluginId: z.string().min(1),
  version: z.string().min(1),
  manifest: pluginManifestSchema,
  /** Stable principal ID for this plugin in Manasvi's identity model */
  principalId: z.string().min(1),
  lifecycleState: pluginLifecycleStateSchema,
  grantedCapabilities: z.array(pluginCapabilityGrantSchema).default([]),
  deniedCapabilityIds: z.array(z.string().min(1)).default([]),
  provenanceVerified: z.boolean().default(false),
  provenanceVerificationNote: z.string().min(1).optional(),
  registeredAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
  revocationRecord: z
    .object({
      revokedAt: z.string().datetime({ offset: true }),
      revokedBy: principalReferenceSchema,
      reason: z.string().min(1)
    })
    .optional()
});
export type PluginRegistryEntry = z.infer<typeof pluginRegistryEntrySchema>;

// ─── Handshake protocol ───────────────────────────────────────────────────────

/** Plugin → Host: sent when the plugin process connects. */
export const pluginHandshakeRequestSchema = z.object({
  protocolVersion: z.literal("1.0"),
  pluginId: z.string().min(1),
  pluginVersion: z.string().min(1),
  /** SHA-256 hex of the manifest JSON as the plugin read it. Verified by host. */
  manifestHash: z.string().min(1),
  requestedCapabilities: z.array(pluginCapabilityRequestSchema).default([]),
  providedTools: z.array(pluginToolDeclarationSchema).default([]),
  supportedApiVersion: z.string().min(1),
  /** URL where this plugin is listening for tool/hook invocations from the host. */
  callbackUrl: z.string().url(),
  /** Optional HMAC token proving publisher identity. */
  provenanceToken: z.string().min(1).optional(),
  timestamp: z.string().datetime({ offset: true }),
  nonce: z.string().min(16)
});
export type PluginHandshakeRequest = z.infer<typeof pluginHandshakeRequestSchema>;

/** Host → Plugin: result of handshake evaluation. */
export const pluginHandshakeResponseSchema = z.object({
  protocolVersion: z.literal("1.0"),
  accepted: z.boolean(),
  pluginPrincipalId: z.string().min(1).optional(),
  grantedCapabilities: z.array(pluginCapabilityGrantSchema).default([]),
  deniedCapabilityIds: z.array(z.string().min(1)).default([]),
  rejectionReason: z.string().min(1).optional(),
  /** Short-lived bearer token for subsequent plugin → host RPC calls. */
  sessionToken: z.string().min(1).optional(),
  timestamp: z.string().datetime({ offset: true })
});
export type PluginHandshakeResponse = z.infer<typeof pluginHandshakeResponseSchema>;

// ─── Plugin RPC (host → plugin invocation) ───────────────────────────────────

export const pluginInvocationRequestSchema = z.object({
  rpcId: z.string().min(1),
  method: z.enum(["tool.invoke", "hook.trigger"]),
  targetId: z.string().min(1),
  payload: z.record(z.unknown()).default({}),
  trace: policyTraceSchema,
  timestamp: z.string().datetime({ offset: true })
});
export type PluginInvocationRequest = z.infer<typeof pluginInvocationRequestSchema>;

export const pluginInvocationResponseSchema = z.object({
  rpcId: z.string().min(1),
  ok: z.boolean(),
  output: z.record(z.unknown()).default({}),
  error: z
    .object({
      code: z.string().min(1),
      message: z.string().min(1)
    })
    .optional(),
  durationMs: z.number().int().nonnegative().optional()
});
export type PluginInvocationResponse = z.infer<typeof pluginInvocationResponseSchema>;

// ─── Plugin lifecycle event (audit record) ────────────────────────────────────

export const pluginLifecycleEventTypeSchema = z.enum([
  "plugin.discovered",
  "plugin.manifest.validated",
  "plugin.manifest.rejected",
  "plugin.provenance.verified",
  "plugin.provenance.failed",
  "plugin.capability.requested",
  "plugin.capability.approved",
  "plugin.capability.denied",
  "plugin.started",
  "plugin.stopped",
  "plugin.handshake.succeeded",
  "plugin.handshake.failed",
  "plugin.unhealthy",
  "plugin.rpc.called",
  "plugin.rpc.failed",
  "plugin.revoked",
  "plugin.tool.invoked"
]);
export type PluginLifecycleEventType = z.infer<typeof pluginLifecycleEventTypeSchema>;

export const pluginLifecycleEventSchema = z.object({
  schemaVersion: z.literal(PLUGIN_CONTRACT_VERSION),
  eventId: z.string().min(1),
  eventType: pluginLifecycleEventTypeSchema,
  pluginId: z.string().min(1),
  pluginVersion: z.string().min(1).optional(),
  lifecycleState: pluginLifecycleStateSchema.optional(),
  principalId: z.string().min(1).optional(),
  capabilityIds: z.array(z.string().min(1)).default([]),
  policyRef: z.string().min(1).optional(),
  provenanceVerified: z.boolean().optional(),
  detail: z.record(z.unknown()).default({}),
  trace: policyTraceSchema,
  timestamp: z.string().datetime({ offset: true })
});
export type PluginLifecycleEvent = z.infer<typeof pluginLifecycleEventSchema>;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Compute a stable SHA-256 hex digest of a plugin manifest for handshake verification. */
export function computeManifestHash(manifest: PluginManifest): string {
  const sorted = JSON.stringify(manifest, Object.keys(manifest).sort());
  return createHash("sha256").update(sorted, "utf8").digest("hex");
}

/** Build the stable plugin principal ID used throughout Manasvi's identity model. */
export function buildPluginPrincipalId(pluginId: string, version: string): string {
  return `plugin:${pluginId}@${version}`;
}

/** Parse and validate a raw plugin manifest. Throws a descriptive error on failure. */
export function parsePluginManifest(input: unknown): PluginManifest {
  const result = pluginManifestSchema.safeParse(input);
  if (!result.success) {
    throw new Error(
      `Invalid plugin manifest: ${result.error.issues
        .map((i) => `${i.path.join(".") || "(root)"} ${i.message}`)
        .join("; ")}`
    );
  }
  return result.data;
}

/** Create a new capability grant record. */
export function createCapabilityGrant(input: {
  capabilityId: string;
  family: PluginCapabilityFamily;
  pluginId: string;
  scope?: Record<string, unknown>;
  constraints?: Record<string, unknown>;
  grantedBy: z.infer<typeof principalReferenceSchema>;
  policyRef?: string;
  expiresAt?: string;
}): PluginCapabilityGrant {
  const now = new Date().toISOString();
  return pluginCapabilityGrantSchema.parse({
    grantId: `grant:${randomUUID()}`,
    capabilityId: input.capabilityId,
    family: input.family,
    pluginId: input.pluginId,
    scope: input.scope ?? {},
    constraints: input.constraints ?? {},
    grantedBy: input.grantedBy,
    ...(input.policyRef !== undefined ? { policyRef: input.policyRef } : {}),
    grantedAt: now,
    ...(input.expiresAt !== undefined ? { expiresAt: input.expiresAt } : {}),
    revoked: false
  });
}

/** Create a plugin lifecycle audit event. */
export function createPluginLifecycleEvent(input: {
  eventType: PluginLifecycleEventType;
  pluginId: string;
  trace: z.infer<typeof policyTraceSchema>;
  pluginVersion?: string;
  lifecycleState?: PluginLifecycleState;
  principalId?: string;
  capabilityIds?: string[];
  policyRef?: string;
  provenanceVerified?: boolean;
  detail?: Record<string, unknown>;
}): PluginLifecycleEvent {
  return pluginLifecycleEventSchema.parse({
    schemaVersion: PLUGIN_CONTRACT_VERSION,
    eventId: `plugin-event:${randomUUID()}`,
    eventType: input.eventType,
    pluginId: input.pluginId,
    ...(input.pluginVersion !== undefined ? { pluginVersion: input.pluginVersion } : {}),
    ...(input.lifecycleState !== undefined ? { lifecycleState: input.lifecycleState } : {}),
    ...(input.principalId !== undefined ? { principalId: input.principalId } : {}),
    capabilityIds: input.capabilityIds ?? [],
    ...(input.policyRef !== undefined ? { policyRef: input.policyRef } : {}),
    ...(input.provenanceVerified !== undefined
      ? { provenanceVerified: input.provenanceVerified }
      : {}),
    detail: input.detail ?? {},
    trace: input.trace,
    timestamp: new Date().toISOString()
  });
}
