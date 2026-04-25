import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  loadPolicySetFromFile,
  loadPolicySetRegistry,
  parseScopedPolicySetMap,
  resolvePolicySetForScope
} from "./policy-loader.js";

test("policy loader returns policy version and load audit metadata", async () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const filePath = join(here, "../../../configs/policies/default-policy-set.json");
  const loaded = await loadPolicySetFromFile({
    filePath,
    loadedByService: "policy-service"
  });
  assert.equal(loaded.policySet.policySetVersion.length > 0, true);
  assert.equal(loaded.loadAuditRecord.policySetVersion, loaded.policySet.policySetVersion);
  assert.equal(loaded.loadAuditRecord.loadedByService, "policy-service");
});

test("scoped policy resolver selects exact, tenant wildcard, then default", async () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const filePath = join(here, "../../../configs/policies/default-policy-set.json");
  const registry = await loadPolicySetRegistry({
    defaultPolicySetPath: filePath,
    scopedPolicySetPaths: {
      "tenant-a/*": filePath,
      "tenant-b/workspace-b": filePath
    },
    loadedByService: "policy-service"
  });

  const exact = resolvePolicySetForScope(registry, {
    tenantId: "tenant-b",
    workspaceId: "workspace-b"
  });
  assert.equal(exact.scopeKey, "tenant-b/workspace-b");

  const tenantWildcard = resolvePolicySetForScope(registry, {
    tenantId: "tenant-a",
    workspaceId: "workspace-z"
  });
  assert.equal(tenantWildcard.scopeKey, "tenant-a/*");

  const fallback = resolvePolicySetForScope(registry, {
    tenantId: "tenant-x",
    workspaceId: "workspace-x"
  });
  assert.equal(fallback.scopeKey, "default");
});

test("scoped policy map parser validates object input", () => {
  const parsed = parseScopedPolicySetMap(
    JSON.stringify({
      "tenant-a/workspace-a": "configs/policies/default-policy-set.json",
      "tenant-a/*": "configs/policies/default-policy-set.json"
    })
  );
  assert.equal(parsed["tenant-a/workspace-a"], "configs/policies/default-policy-set.json");
  assert.equal(parsed["tenant-a/*"], "configs/policies/default-policy-set.json");
});
