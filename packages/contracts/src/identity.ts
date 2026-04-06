import { z } from "zod";

import { CONTRACT_SCHEMA_VERSION, serviceNameSchema } from "./base.js";

export const principalSchemaVersion = "1.0" as const;
export const tokenClaimsVersion = "1.0" as const;
export const sessionOwnershipVersion = "1.0" as const;

export const principalTypeSchema = z.enum([
  "human_user",
  "agent",
  "channel",
  "plugin",
  "service",
  "execution_node",
  "tool",
  "tenant_workspace",
  "system_automation",
  "approval_authority",
  "anonymous_external"
]);
export type PrincipalType = z.infer<typeof principalTypeSchema>;

export const principalStatusSchema = z.enum(["active", "disabled", "revoked", "deleted"]);
export type PrincipalStatus = z.infer<typeof principalStatusSchema>;

export const externalIdentifierSchema = z.object({
  provider: z.string().min(1),
  type: z.string().min(1),
  value: z.string().min(1)
});
export type ExternalIdentifier = z.infer<typeof externalIdentifierSchema>;

export const principalAttributesSchema = z.record(z.unknown()).default({});

export const principalReferenceSchema = z.object({
  principalId: z.string().min(1),
  principalType: principalTypeSchema,
  tenantId: z.string().min(1).optional(),
  workspaceId: z.string().min(1).optional(),
  displayName: z.string().min(1).optional()
});
export type PrincipalReference = z.infer<typeof principalReferenceSchema>;

export const serviceIdentityMetadataSchema = z.object({
  serviceName: serviceNameSchema,
  instanceId: z.string().min(1),
  environment: z.enum(["local", "dev", "test", "staging", "production"]),
  workloadIdentityProvider: z.string().min(1).optional(),
  registeredAt: z.string().datetime({ offset: true })
});
export type ServiceIdentityMetadata = z.infer<typeof serviceIdentityMetadataSchema>;

export const nodeIdentityMetadataSchema = z.object({
  nodeId: z.string().min(1),
  mode: z.enum(["local", "remote"]),
  status: z.enum(["registered", "paired", "active", "quarantined", "revoked"]),
  runtimeClass: z.string().min(1).default("sandboxed"),
  sandboxProfile: z.string().min(1).default("default"),
  attestationRef: z.string().min(1).optional(),
  registeredAt: z.string().datetime({ offset: true })
});
export type NodeIdentityMetadata = z.infer<typeof nodeIdentityMetadataSchema>;

export const principalRecordSchema = z.object({
  schemaVersion: z.literal(principalSchemaVersion),
  contractVersion: z.literal(CONTRACT_SCHEMA_VERSION),
  principalId: z.string().min(1),
  principalType: principalTypeSchema,
  displayName: z.string().min(1).optional(),
  tenantId: z.string().min(1).optional(),
  workspaceId: z.string().min(1).optional(),
  status: principalStatusSchema.default("active"),
  provenance: z.object({
    source: z.enum(["bootstrap", "api", "sync", "node_registration", "channel_ingress", "system"]),
    sourceRef: z.string().min(1).optional()
  }),
  externalIdentifiers: z.array(externalIdentifierSchema).default([]),
  attributes: principalAttributesSchema,
  service: serviceIdentityMetadataSchema.optional(),
  executionNode: nodeIdentityMetadataSchema.optional(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true })
});
export type PrincipalRecord = z.infer<typeof principalRecordSchema>;

export const principalClaimsSchema = z.object({
  version: z.literal(tokenClaimsVersion),
  issuer: z.string().min(1),
  audience: z.string().min(1),
  issuedAt: z.number().int().positive(),
  expiresAt: z.number().int().positive(),
  tokenId: z.string().min(1),
  scopes: z.array(z.string().min(1)).default([]),
  caller: principalReferenceSchema,
  actor: principalReferenceSchema.optional(),
  subject: principalReferenceSchema.optional(),
  origin: principalReferenceSchema.optional(),
  sessionOwner: principalReferenceSchema.optional(),
  tenantId: z.string().min(1).optional(),
  workspaceId: z.string().min(1).optional(),
  authnStrength: z.enum(["none", "weak", "strong"]).default("strong")
});
export type PrincipalClaims = z.infer<typeof principalClaimsSchema>;

export const resolvedPrincipalContextSchema = z.object({
  caller: principalReferenceSchema,
  actor: principalReferenceSchema,
  subject: principalReferenceSchema.optional(),
  origin: principalReferenceSchema.optional(),
  service: principalReferenceSchema.optional(),
  sessionOwner: principalReferenceSchema.optional(),
  tenantId: z.string().min(1).optional(),
  workspaceId: z.string().min(1).optional(),
  scopes: z.array(z.string().min(1)).default([]),
  authnStrength: z.enum(["none", "weak", "strong"]),
  tokenId: z.string().min(1).optional(),
  authenticated: z.boolean()
});
export type ResolvedPrincipalContext = z.infer<typeof resolvedPrincipalContextSchema>;

export const sessionParticipantSchema = z.object({
  principal: principalReferenceSchema,
  role: z.string().min(1).optional()
});
export type SessionParticipant = z.infer<typeof sessionParticipantSchema>;

export const sessionOwnershipSchema = z.object({
  version: z.literal(sessionOwnershipVersion),
  sessionId: z.string().min(1),
  owner: principalReferenceSchema,
  participants: z.array(sessionParticipantSchema).default([]),
  tenantId: z.string().min(1),
  workspaceId: z.string().min(1),
  createdBy: principalReferenceSchema,
  lastActedBy: principalReferenceSchema.optional(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true })
});
export type SessionOwnership = z.infer<typeof sessionOwnershipSchema>;
