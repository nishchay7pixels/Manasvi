import assert from "node:assert/strict";
import test from "node:test";

import type { PluginManifest } from "@manasvi/contracts";

import {
  evaluateTenantPluginRestriction,
  parseTenantPluginRestrictions
} from "./tenant-restrictions.js";

function manifest(overrides?: Partial<PluginManifest>): PluginManifest {
  return {
    manifestVersion: "1.0",
    pluginId: "com.example.search",
    name: "Search Plugin",
    version: "1.0.0",
    publisher: "example",
    runtimeType: "node",
    entrypoint: "plugins/search/index.js",
    supportedApiVersion: "1.0",
    requestedCapabilities: [
      {
        capabilityId: "cap:network",
        family: "access-network",
        scope: {},
        required: true
      }
    ],
    providedTools: [],
    providedHooks: [],
    requiredSecretRefs: [],
    requiredNetworkDomains: [],
    requiredFilesystemZones: [],
    riskClass: "medium",
    enabled: true,
    deprecationState: "active",
    tags: [],
    ...(overrides ?? {})
  };
}

test("tenant plugin restrictions deny plugin by tenant/workspace", () => {
  const restrictions = parseTenantPluginRestrictions(
    JSON.stringify([
      {
        tenantId: "tenant-a",
        workspaceId: "workspace-a",
        pluginIdPattern: "com.example.search",
        pluginVersionPattern: "*",
        action: "start",
        effect: "deny",
        reason: "workspace deny list"
      }
    ])
  );
  const decision = evaluateTenantPluginRestriction({
    restrictions,
    scope: {
      tenantId: "tenant-a",
      workspaceId: "workspace-a"
    },
    manifest: manifest(),
    action: "start"
  });
  assert.equal(decision.allowed, false);
  assert.match(decision.reason, /deny list/);
});

test("tenant plugin restrictions support workspace-specific allow with capability denial", () => {
  const restrictions = parseTenantPluginRestrictions(
    JSON.stringify([
      {
        tenantId: "tenant-a",
        workspaceId: "workspace-safe",
        pluginIdPattern: "com.example.*",
        action: "register",
        effect: "allow",
        deniedCapabilityFamilies: ["access-secret"],
        reason: "safe workspace allowlist"
      }
    ])
  );
  const decisionAllowed = evaluateTenantPluginRestriction({
    restrictions,
    scope: {
      tenantId: "tenant-a",
      workspaceId: "workspace-safe"
    },
    manifest: manifest(),
    action: "register"
  });
  assert.equal(decisionAllowed.allowed, true);

  const decisionDenied = evaluateTenantPluginRestriction({
    restrictions,
    scope: {
      tenantId: "tenant-a",
      workspaceId: "workspace-safe"
    },
    manifest: manifest({
      requestedCapabilities: [
        {
          capabilityId: "cap:secret",
          family: "access-secret",
          scope: {},
          required: true
        }
      ]
    }),
    action: "register"
  });
  assert.equal(decisionDenied.allowed, false);
  assert.match(decisionDenied.reason, /capability family access-secret denied/);
});
