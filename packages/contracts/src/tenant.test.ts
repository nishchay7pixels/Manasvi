import assert from "node:assert/strict";
import test from "node:test";

import {
  tenantEntitySchema,
  tenantScopedResourceReferenceSchema,
  workspaceEntitySchema
} from "./tenant.js";

test("tenant and workspace entities validate with explicit linkage", () => {
  const now = new Date().toISOString();
  const tenant = tenantEntitySchema.parse({
    schemaVersion: "1.0",
    contractVersion: "1.0.0",
    tenantId: "tenant-acme",
    displayName: "Acme",
    state: "active",
    labels: [],
    metadata: {},
    adminPrincipals: [],
    defaultWorkspaceId: "workspace-core",
    createdAt: now,
    updatedAt: now
  });
  const workspace = workspaceEntitySchema.parse({
    schemaVersion: "1.0",
    contractVersion: "1.0.0",
    workspaceId: "workspace-core",
    tenantId: "tenant-acme",
    displayName: "Core Team",
    state: "active",
    labels: [],
    metadata: {},
    adminPrincipals: [],
    isDefaultWorkspace: true,
    createdAt: now,
    updatedAt: now
  });
  assert.equal(workspace.tenantId, tenant.tenantId);
});

test("workspace scope requires tenantId and workspaceId", () => {
  const parsed = tenantScopedResourceReferenceSchema.safeParse({
    resourceType: "memory-namespace",
    resourceId: "tenant/tenant-a/workspace/workspace-a/shared",
    scope: {
      scope: "workspace",
      tenantId: "tenant-a"
    }
  });
  assert.equal(parsed.success, false);
});
