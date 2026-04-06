import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { loadPolicySetFromFile } from "./policy-loader.js";

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
