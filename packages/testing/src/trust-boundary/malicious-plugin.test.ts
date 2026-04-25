import assert from "node:assert/strict";
import test from "node:test";

import { getAssumption } from "./assumptions.js";
import { fixtureMaliciousPluginManifest } from "./fixtures.js";

import { CapabilityApprover } from "../../../../apps/extension-runtime/src/capability-approver.js";
import { validatePluginManifest } from "../../../../apps/extension-runtime/src/plugin-manifest.js";
import { PluginRegistry } from "../../../../apps/extension-runtime/src/plugin-registry.js";

test("[TB-PLUGIN-001][plugin] malicious plugin requests do not self-grant high-risk capabilities", () => {
  const assumption = getAssumption("TB-PLUGIN-001");
  const manifest = fixtureMaliciousPluginManifest();
  const validated = validatePluginManifest(manifest);
  assert.equal(validated.ok, true, `fixture must stay valid for ${assumption.assumptionId}`);

  const approver = new CapabilityApprover({
    requireExplicitCapabilityApproval: true,
    approvalAuthority: { principalId: "service:extension-runtime", principalType: "service" }
  });
  const evaluation = approver.evaluateRequests(validated.manifest!);
  assert.equal(evaluation.granted.length, 0);
  assert.equal(evaluation.requiresExplicitApproval, true);
});

test("[TB-PLUGIN-001][plugin] revoked plugin cannot retain active granted capabilities", () => {
  const manifest = fixtureMaliciousPluginManifest({
    pluginId: "revoked.plugin.test",
    requestedCapabilities: [
      {
        capabilityId: "cap:provide-tools",
        family: "provide-tools",
        scope: {},
        required: true
      }
    ],
    requiredSecretRefs: []
  });
  const registry = new PluginRegistry();
  const entry = registry.register(manifest);
  registry.setCapabilityGrants(
    manifest.pluginId,
    [
      {
        grantId: "grant:tools",
        capabilityId: "cap:provide-tools",
        family: "provide-tools",
        pluginId: manifest.pluginId,
        scope: {},
        constraints: {},
        grantedBy: { principalId: "service:extension-runtime", principalType: "service" },
        grantedAt: new Date().toISOString(),
        revoked: false
      }
    ],
    []
  );
  assert.equal(registry.hasGrantedCapability(manifest.pluginId, "cap:provide-tools"), true);
  registry.revoke(manifest.pluginId, { principalId: "service:extension-runtime", principalType: "service" }, "malicious behavior");
  assert.equal(registry.isRevoked(manifest.pluginId), true);
  assert.equal(registry.hasGrantedCapability(manifest.pluginId, "cap:provide-tools"), false);
  assert.equal(entry.lifecycleState, "discovered");
});

test("[TB-PLUGIN-001][plugin][control] low-risk plugin gets bounded auto-approval in explicit-off mode", () => {
  const manifest = fixtureMaliciousPluginManifest({
    pluginId: "safe.plugin.test",
    riskClass: "low",
    requestedCapabilities: [
      {
        capabilityId: "cap:provide-tools",
        family: "provide-tools",
        scope: {},
        required: true
      }
    ],
    requiredSecretRefs: []
  });
  const approver = new CapabilityApprover({
    requireExplicitCapabilityApproval: false,
    approvalAuthority: { principalId: "service:extension-runtime", principalType: "service" }
  });
  const evaluation = approver.evaluateRequests(manifest);
  assert.equal(evaluation.requiresExplicitApproval, false);
  assert.equal(evaluation.granted.length, 1);
  assert.equal(evaluation.granted[0]?.family, "provide-tools");
});
