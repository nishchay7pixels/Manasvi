import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";

import { CONTRACT_SCHEMA_VERSION } from "./base.js";
import { approvedIntentArtifactSchema, executionIntentSchema } from "./execution-intent.js";
import { runtimePolicySchema } from "./execution-runtime.js";
import { principalReferenceSchema } from "./identity.js";
import { actionClassSchema, policyTraceSchema } from "./policy.js";
import { toolExecutionContractSchema } from "./tools.js";

export const NODE_CONTRACT_VERSION = "1.0" as const;

export const nodeClassSchema = z.enum([
  "local_node",
  "trusted_personal_node",
  "restricted_utility_node",
  "high_risk_isolated_node"
]);
export type NodeClass = z.infer<typeof nodeClassSchema>;

export const nodeStatusSchema = z.enum([
  "pending_pairing",
  "paired",
  "active",
  "quarantined",
  "revoked",
  "decommissioned"
]);
export type NodeStatus = z.infer<typeof nodeStatusSchema>;

export const nodeCapabilitySchema = z.object({
  capabilityId: z.string().min(1),
  description: z.string().min(1),
  supportedSandboxModes: z.array(runtimePolicySchema.shape.sandboxMode).default([]),
  actionClasses: z.array(actionClassSchema).default([]),
  networkProfiles: z.array(z.string().min(1)).default([]),
  filesystemProfiles: z.array(z.string().min(1)).default([]),
  maxConcurrentRuns: z.number().int().positive().default(1),
  constraints: z.record(z.unknown()).default({})
});
export type NodeCapability = z.infer<typeof nodeCapabilitySchema>;

export const nodeAttestationMetadataSchema = z.object({
  attestationId: z.string().min(1),
  recordedAt: z.string().datetime({ offset: true }),
  source: z.enum(["node-agent", "operator", "system"]),
  verificationStatus: z.enum(["verified", "unverified", "mismatch"]),
  verificationConfidence: z.enum(["low", "medium", "high"]),
  runtimeVersion: z.string().min(1),
  os: z.string().min(1),
  arch: z.string().min(1),
  environmentClass: z.string().min(1).default("unknown"),
  sandboxSupport: z.array(runtimePolicySchema.shape.sandboxMode).default([]),
  networkZone: z.string().min(1).default("default"),
  filesystemProfileHint: z.string().min(1).default("read_only"),
  capabilityClaims: z.array(z.string().min(1)).default([]),
  integrityHash: z.string().min(1).optional(),
  notes: z.array(z.string().min(1)).default([])
});
export type NodeAttestationMetadata = z.infer<typeof nodeAttestationMetadataSchema>;

export const nodeCredentialSchema = z.object({
  tokenId: z.string().min(1),
  keyId: z.string().min(1),
  issuedAt: z.string().datetime({ offset: true }),
  expiresAt: z.string().datetime({ offset: true }),
  scopes: z.array(z.string().min(1)).default([])
});
export type NodeCredential = z.infer<typeof nodeCredentialSchema>;

export const nodeHeartbeatSchema = z.object({
  heartbeatId: z.string().min(1),
  nodeId: z.string().min(1),
  timestamp: z.string().datetime({ offset: true }),
  status: z.enum(["healthy", "degraded", "unhealthy"]),
  runtimeVersion: z.string().min(1),
  load: z.object({
    activeRuns: z.number().int().nonnegative(),
    cpuPct: z.number().min(0).max(100),
    memoryPct: z.number().min(0).max(100)
  }),
  attestationFresh: z.boolean().default(true),
  capabilityHash: z.string().min(1),
  trace: policyTraceSchema
});
export type NodeHeartbeat = z.infer<typeof nodeHeartbeatSchema>;

export const nodeIdentitySchema = z.object({
  schemaVersion: z.literal(NODE_CONTRACT_VERSION),
  contractVersion: z.literal(CONTRACT_SCHEMA_VERSION),
  nodeId: z.string().min(1),
  principal: principalReferenceSchema,
  nodeClass: nodeClassSchema,
  status: nodeStatusSchema,
  tenantId: z.string().min(1),
  workspaceId: z.string().min(1),
  ownerPrincipal: principalReferenceSchema.optional(),
  managingPrincipal: principalReferenceSchema.optional(),
  pairedBy: principalReferenceSchema.optional(),
  pairedAt: z.string().datetime({ offset: true }).optional(),
  lastHeartbeatAt: z.string().datetime({ offset: true }).optional(),
  heartbeatStatus: nodeHeartbeatSchema.shape.status.optional(),
  heartbeatStale: z.boolean().default(false),
  attestation: nodeAttestationMetadataSchema,
  capabilities: z.array(nodeCapabilitySchema).default([]),
  riskLevel: z.enum(["low", "medium", "high", "critical"]).default("medium"),
  quarantined: z.boolean().default(false),
  quarantineReason: z.string().min(1).optional(),
  quarantineAt: z.string().datetime({ offset: true }).optional(),
  revoked: z.boolean().default(false),
  revokedReason: z.string().min(1).optional(),
  revokedAt: z.string().datetime({ offset: true }).optional(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
  labels: z.array(z.string().min(1)).default([])
});
export type NodeIdentity = z.infer<typeof nodeIdentitySchema>;

export const nodePairingRequestSchema = z.object({
  schemaVersion: z.literal(NODE_CONTRACT_VERSION),
  requestId: z.string().min(1),
  nodeId: z.string().min(1),
  nodeClass: nodeClassSchema,
  tenantId: z.string().min(1),
  workspaceId: z.string().min(1),
  ownerPrincipal: principalReferenceSchema.optional(),
  attestation: nodeAttestationMetadataSchema,
  requestedCapabilities: z.array(nodeCapabilitySchema).default([]),
  trace: policyTraceSchema
});
export type NodePairingRequest = z.infer<typeof nodePairingRequestSchema>;

export const nodePairingGrantSchema = z.object({
  schemaVersion: z.literal(NODE_CONTRACT_VERSION),
  pairingId: z.string().min(1),
  nodeId: z.string().min(1),
  status: z.enum(["pending", "paired", "rejected"]),
  reason: z.string().min(1).optional(),
  issuedCredential: nodeCredentialSchema.optional(),
  expiresAt: z.string().datetime({ offset: true }),
  trace: policyTraceSchema
});
export type NodePairingGrant = z.infer<typeof nodePairingGrantSchema>;

export const nodeDispatchRequestSchema = z.object({
  schemaVersion: z.literal(NODE_CONTRACT_VERSION),
  dispatchId: z.string().min(1),
  nodeId: z.string().min(1),
  executionIntent: executionIntentSchema,
  approvedArtifact: approvedIntentArtifactSchema,
  toolContract: toolExecutionContractSchema,
  runtimePolicy: runtimePolicySchema,
  scopedExecutionToken: z.string().min(1),
  expiresAt: z.string().datetime({ offset: true }),
  policyDecisionId: z.string().min(1),
  /**
   * One-time nonce scoped to this dispatch attempt.
   * The receiving node agent must reject duplicate nonces to prevent
   * replayed dispatch messages from triggering repeated executions.
   */
  dispatchNonce: z.string().min(1),
  /**
   * SHA-256 of the canonical dispatch payload (intent payloadHash + artifactId + nodeId + dispatchId + expiresAt).
   * The node agent verifies this hash before accepting the dispatch.
   * Mutation of any linked field produces a mismatch and is rejected.
   */
  dispatchPayloadHash: z.string().min(1),
  trace: policyTraceSchema,
  metadata: z.record(z.unknown()).default({})
});
export type NodeDispatchRequest = z.infer<typeof nodeDispatchRequestSchema>;

/**
 * Compute the canonical dispatch payload hash for a node dispatch.
 * Covers the fields that uniquely identify and scope the dispatch.
 * The hash is verified by the node agent before accepting the workload.
 *
 * Canonicalization: fields joined with "|" in a fixed, documented order.
 * This is stable across serialization and does not depend on JSON key order.
 */
export function computeDispatchPayloadHash(input: {
  intentPayloadHash: string;
  artifactId: string;
  nodeId: string;
  dispatchId: string;
  expiresAt: string;
}): string {
  const canonical = [
    input.intentPayloadHash,
    input.artifactId,
    input.nodeId,
    input.dispatchId,
    input.expiresAt
  ].join("|");
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

export const nodeDispatchResultSchema = z.object({
  schemaVersion: z.literal(NODE_CONTRACT_VERSION),
  dispatchId: z.string().min(1),
  nodeId: z.string().min(1),
  accepted: z.boolean(),
  status: z.enum([
    "accepted",
    "rejected",
    "completed",
    "failed",
    "timed_out",
    "policy_blocked",
    "validation_failed"
  ]),
  reasonCode: z.string().min(1).optional(),
  runId: z.string().min(1).optional(),
  resultArtifactId: z.string().min(1).optional(),
  trace: policyTraceSchema
});
export type NodeDispatchResult = z.infer<typeof nodeDispatchResultSchema>;

export const nodeQuarantineRecordSchema = z.object({
  schemaVersion: z.literal(NODE_CONTRACT_VERSION),
  quarantineId: z.string().min(1),
  nodeId: z.string().min(1),
  reasonCode: z.string().min(1),
  reason: z.string().min(1),
  quarantinedBy: principalReferenceSchema,
  quarantinedAt: z.string().datetime({ offset: true }),
  inFlightDisposition: z.enum(["allow_completion", "cancel_if_possible"]).default("allow_completion"),
  trace: policyTraceSchema
});
export type NodeQuarantineRecord = z.infer<typeof nodeQuarantineRecordSchema>;

export const nodeRevocationRecordSchema = z.object({
  schemaVersion: z.literal(NODE_CONTRACT_VERSION),
  revocationId: z.string().min(1),
  nodeId: z.string().min(1),
  reasonCode: z.string().min(1),
  reason: z.string().min(1),
  revokedBy: principalReferenceSchema,
  revokedAt: z.string().datetime({ offset: true }),
  trace: policyTraceSchema
});
export type NodeRevocationRecord = z.infer<typeof nodeRevocationRecordSchema>;

export function createNodePairingGrant(input: {
  nodeId: string;
  status: "pending" | "paired" | "rejected";
  expiresAt: string;
  trace: z.infer<typeof policyTraceSchema>;
  issuedCredential?: NodeCredential;
  reason?: string;
}): NodePairingGrant {
  return nodePairingGrantSchema.parse({
    schemaVersion: NODE_CONTRACT_VERSION,
    pairingId: `pairing:${randomUUID()}`,
    nodeId: input.nodeId,
    status: input.status,
    ...(input.reason ? { reason: input.reason } : {}),
    ...(input.issuedCredential ? { issuedCredential: input.issuedCredential } : {}),
    expiresAt: input.expiresAt,
    trace: input.trace
  });
}
