import { z } from "zod";

import { CONTRACT_SCHEMA_VERSION } from "./base.js";
import { principalReferenceSchema } from "./identity.js";

export const TENANT_CONTRACT_VERSION = "1.0" as const;

export const tenantStateSchema = z.enum(["active", "suspended", "deleting", "deleted"]);
export type TenantState = z.infer<typeof tenantStateSchema>;

export const workspaceStateSchema = z.enum(["active", "archived", "suspended", "deleted"]);
export type WorkspaceState = z.infer<typeof workspaceStateSchema>;

export const tenantEntitySchema = z.object({
  schemaVersion: z.literal(TENANT_CONTRACT_VERSION),
  contractVersion: z.literal(CONTRACT_SCHEMA_VERSION),
  tenantId: z.string().min(1),
  displayName: z.string().min(1),
  state: tenantStateSchema.default("active"),
  labels: z.array(z.string().min(1)).default([]),
  metadata: z.record(z.unknown()).default({}),
  owner: principalReferenceSchema.optional(),
  adminPrincipals: z.array(principalReferenceSchema).default([]),
  defaultWorkspaceId: z.string().min(1).optional(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true })
});
export type TenantEntity = z.infer<typeof tenantEntitySchema>;

export const workspaceEntitySchema = z.object({
  schemaVersion: z.literal(TENANT_CONTRACT_VERSION),
  contractVersion: z.literal(CONTRACT_SCHEMA_VERSION),
  workspaceId: z.string().min(1),
  tenantId: z.string().min(1),
  displayName: z.string().min(1),
  state: workspaceStateSchema.default("active"),
  labels: z.array(z.string().min(1)).default([]),
  metadata: z.record(z.unknown()).default({}),
  owner: principalReferenceSchema.optional(),
  adminPrincipals: z.array(principalReferenceSchema).default([]),
  isDefaultWorkspace: z.boolean().default(false),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true })
});
export type WorkspaceEntity = z.infer<typeof workspaceEntitySchema>;

export const scopeKindSchema = z.enum(["global", "tenant", "workspace"]);
export type ScopeKind = z.infer<typeof scopeKindSchema>;

export const tenantWorkspaceScopeSchema = z.object({
  scope: scopeKindSchema.default("workspace"),
  tenantId: z.string().min(1).optional(),
  workspaceId: z.string().min(1).optional()
}).superRefine((value, ctx) => {
  if (value.scope === "global") {
    return;
  }
  if (!value.tenantId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "tenantId is required for tenant/workspace scope"
    });
  }
  if (value.scope === "workspace" && !value.workspaceId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "workspaceId is required for workspace scope"
    });
  }
});
export type TenantWorkspaceScope = z.infer<typeof tenantWorkspaceScopeSchema>;

export const tenantScopedResourceReferenceSchema = z.object({
  resourceType: z.string().min(1),
  resourceId: z.string().min(1),
  scope: tenantWorkspaceScopeSchema,
  ownerPrincipalId: z.string().min(1).optional(),
  attributes: z.record(z.unknown()).default({})
});
export type TenantScopedResourceReference = z.infer<typeof tenantScopedResourceReferenceSchema>;
