import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { parsePluginManifest } from "@manasvi/contracts";
import { CapabilityApprover } from "./capability-approver.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const authority = {
  principalId: "service:extension-runtime",
  principalType: "service" as const
};

const lowRiskManifest = parsePluginManifest({
  manifestVersion: "1.0",
  pluginId: "com.example.low-risk",
  name: "low-risk-plugin",
  version: "0.1.0",
  publisher: "example",
  runtimeType: "node",
  entrypoint: "plugin.js",
  supportedApiVersion: "1.0",
  riskClass: "low",
  requestedCapabilities: [
    { capabilityId: "low-risk:provide-tools", family: "provide-tools", scope: {}, required: true }
  ],
  providedTools: [
    { toolId: "lr.echo", name: "echo", description: "echo", inputSchema: {}, outputSchema: {}, sideEffects: [], requiresApproval: false }
  ],
  providedHooks: [],
  requiredSecretRefs: [],
  requiredNetworkDomains: [],
  requiredFilesystemZones: [],
  enabled: true,
  deprecationState: "active",
  tags: []
});

const highRiskManifest = parsePluginManifest({
  manifestVersion: "1.0",
  pluginId: "com.example.high-risk",
  name: "high-risk-plugin",
  version: "0.1.0",
  publisher: "example",
  runtimeType: "node",
  entrypoint: "plugin.js",
  supportedApiVersion: "1.0",
  riskClass: "high",
  requestedCapabilities: [
    { capabilityId: "high-risk:provide-tools", family: "provide-tools", scope: {}, required: false, justification: "Provides tools" },
    { capabilityId: "high-risk:access-network", family: "access-network", scope: {}, required: true, justification: "Needs network" }
  ],
  providedTools: [
    { toolId: "hr.fetch", name: "fetch", description: "fetch", inputSchema: {}, outputSchema: {}, sideEffects: ["external-call"], requiresApproval: false }
  ],
  providedHooks: [],
  requiredSecretRefs: [],
  requiredNetworkDomains: ["*.example.com"],
  requiredFilesystemZones: [],
  enabled: true,
  deprecationState: "active",
  tags: []
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("CapabilityApprover.evaluateRequests", () => {
  it("auto-approves low-risk capabilities for low-risk plugins when explicit approval not required", () => {
    const approver = new CapabilityApprover({
      requireExplicitCapabilityApproval: false,
      approvalAuthority: authority
    });

    const result = approver.evaluateRequests(lowRiskManifest);

    assert.equal(result.requiresExplicitApproval, false);
    assert.equal(result.granted.length, 1);
    assert.equal(result.denied.length, 0);
    assert.equal(result.granted[0]?.family, "provide-tools");
    assert.equal(result.granted[0]?.revoked, false);
  });

  it("does NOT auto-approve when requireExplicitCapabilityApproval is true", () => {
    const approver = new CapabilityApprover({
      requireExplicitCapabilityApproval: true,
      approvalAuthority: authority
    });

    const result = approver.evaluateRequests(lowRiskManifest);

    assert.equal(result.requiresExplicitApproval, true);
    assert.equal(result.granted.length, 0);
  });

  it("requires explicit approval for high-risk capabilities", () => {
    const approver = new CapabilityApprover({
      requireExplicitCapabilityApproval: false, // even with this false
      approvalAuthority: authority
    });

    const result = approver.evaluateRequests(highRiskManifest);

    // access-network is high-risk, so must require explicit approval
    assert.equal(result.requiresExplicitApproval, true);
  });

  it("requires explicit approval for high-risk-class plugins regardless of capability", () => {
    const approver = new CapabilityApprover({
      requireExplicitCapabilityApproval: false,
      approvalAuthority: authority
    });

    const result = approver.evaluateRequests(highRiskManifest);
    assert.equal(result.requiresExplicitApproval, true);
  });
});

describe("CapabilityApprover.applyExplicitApproval", () => {
  it("grants only the explicitly approved capabilities", () => {
    const approver = new CapabilityApprover({
      requireExplicitCapabilityApproval: true,
      approvalAuthority: authority
    });

    const result = approver.applyExplicitApproval(
      highRiskManifest,
      ["high-risk:provide-tools"], // only approving this one
      authority,
      "policy:manual-review-001"
    );

    assert.equal(result.granted.length, 1);
    assert.equal(result.granted[0]?.capabilityId, "high-risk:provide-tools");
    assert.equal(result.denied.length, 1);
    assert.equal(result.denied[0], "high-risk:access-network");
    assert.equal(result.requiresExplicitApproval, false);
  });

  it("denies all capabilities when approvedCapabilityIds is empty", () => {
    const approver = new CapabilityApprover({
      requireExplicitCapabilityApproval: true,
      approvalAuthority: authority
    });

    const result = approver.applyExplicitApproval(highRiskManifest, [], authority);

    assert.equal(result.granted.length, 0);
    assert.equal(result.denied.length, 2);
  });

  it("grants all capabilities when all IDs are approved", () => {
    const approver = new CapabilityApprover({
      requireExplicitCapabilityApproval: true,
      approvalAuthority: authority
    });

    const allCapIds = highRiskManifest.requestedCapabilities.map((c) => c.capabilityId);
    const result = approver.applyExplicitApproval(highRiskManifest, allCapIds, authority);

    assert.equal(result.granted.length, 2);
    assert.equal(result.denied.length, 0);
  });

  it("ignores capability IDs not in manifest", () => {
    const approver = new CapabilityApprover({
      requireExplicitCapabilityApproval: true,
      approvalAuthority: authority
    });

    const result = approver.applyExplicitApproval(
      highRiskManifest,
      ["made-up-capability-id"],
      authority
    );

    assert.equal(result.granted.length, 0); // "made-up-capability-id" not in manifest, so no grants
    assert.equal(result.denied.length, 2); // both real caps denied
  });
});

describe("CapabilityApprover.isCapabilityGranted", () => {
  it("returns true for an active grant", () => {
    const approver = new CapabilityApprover({
      requireExplicitCapabilityApproval: false,
      approvalAuthority: authority
    });

    const result = approver.evaluateRequests(lowRiskManifest);
    const grants = result.granted;

    assert.equal(
      approver.isCapabilityGranted(grants, "low-risk:provide-tools"),
      true
    );
  });

  it("returns false for a revoked grant", () => {
    const approver = new CapabilityApprover({
      requireExplicitCapabilityApproval: false,
      approvalAuthority: authority
    });

    const result = approver.evaluateRequests(lowRiskManifest);
    const revokedGrants = result.granted.map((g) => ({
      ...g,
      revoked: true,
      revokedAt: new Date().toISOString(),
      revokedReason: "test revocation"
    }));

    assert.equal(
      approver.isCapabilityGranted(revokedGrants, "low-risk:provide-tools"),
      false
    );
  });

  it("returns false for a capability not in grants", () => {
    const approver = new CapabilityApprover({
      requireExplicitCapabilityApproval: false,
      approvalAuthority: authority
    });

    const result = approver.evaluateRequests(lowRiskManifest);

    assert.equal(
      approver.isCapabilityGranted(result.granted, "access-network"),
      false
    );
  });
});
