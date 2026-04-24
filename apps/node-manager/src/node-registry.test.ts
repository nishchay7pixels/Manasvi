import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";

import { NodeRegistry } from "./node-registry.js";

function trace() {
  return { traceId: randomUUID(), correlationId: randomUUID() };
}

function attestation(nowIso: string) {
  return {
    attestationId: `att:${Date.now()}`,
    recordedAt: nowIso,
    source: "node-agent" as const,
    verificationStatus: "verified" as const,
    verificationConfidence: "high" as const,
    runtimeVersion: "node-agent/1.0.0",
    os: "linux",
    arch: "x64",
    environmentClass: "remote",
    sandboxSupport: ["restricted_remote" as const],
    networkZone: "zone-a",
    filesystemProfileHint: "bounded",
    capabilityClaims: ["node.execute"],
    notes: []
  };
}

function capabilities() {
  return [
    {
      capabilityId: "node.execute",
      description: "execute constrained workloads",
      supportedSandboxModes: ["restricted_remote" as const],
      actionClasses: ["execute" as const],
      networkProfiles: ["allowlist"],
      filesystemProfiles: ["bounded"],
      maxConcurrentRuns: 2,
      constraints: {}
    }
  ];
}

test("node pairing success and activation", () => {
  const registry = new NodeRegistry(30_000);
  const nowIso = new Date().toISOString();
  registry.registerPairing(
    {
      nodeId: "node:test-1",
      nodeClass: "restricted_utility_node",
      tenantId: "tenant-local",
      workspaceId: "workspace-local",
      principalId: "node:node:test-1",
      attestation: attestation(nowIso),
      requestedCapabilities: capabilities(),
      nowIso
    },
    "pair-token-1",
    Date.now() + 60_000
  );
  const activated = registry.completePairing({
    nodeId: "node:test-1",
    pairingTokenId: "pair-token-1",
    nowIso
  });
  assert.ok(activated);
  assert.equal(activated?.status, "active");
});

test("invalid pairing completion is rejected", () => {
  const registry = new NodeRegistry(30_000);
  const nowIso = new Date().toISOString();
  registry.registerPairing(
    {
      nodeId: "node:test-2",
      nodeClass: "restricted_utility_node",
      tenantId: "tenant-local",
      workspaceId: "workspace-local",
      principalId: "node:node:test-2",
      attestation: attestation(nowIso),
      requestedCapabilities: capabilities(),
      nowIso
    },
    "pair-token-2",
    Date.now() + 60_000
  );
  const activated = registry.completePairing({
    nodeId: "node:test-2",
    pairingTokenId: "wrong-token",
    nowIso
  });
  assert.equal(activated, undefined);
});

test("stale heartbeat removes dispatch eligibility", () => {
  const registry = new NodeRegistry(10);
  const nowIso = new Date().toISOString();
  registry.registerPairing(
    {
      nodeId: "node:test-3",
      nodeClass: "restricted_utility_node",
      tenantId: "tenant-local",
      workspaceId: "workspace-local",
      principalId: "node:node:test-3",
      attestation: attestation(nowIso),
      requestedCapabilities: capabilities(),
      nowIso
    },
    "pair-token-3",
    Date.now() + 60_000
  );
  registry.completePairing({
    nodeId: "node:test-3",
    pairingTokenId: "pair-token-3",
    nowIso
  });
  registry.recordHeartbeat(
    {
      nodeId: "node:test-3",
      nowIso,
      status: "healthy",
      runtimeVersion: "node-agent/1.0.0",
      load: { activeRuns: 0, cpuPct: 10, memoryPct: 20 },
      attestationFresh: true
    },
    trace()
  );
  const eligibleNow = registry.dispatchEligibility({
    nodeId: "node:test-3",
    requiredSandboxMode: "restricted_remote",
    requiredActionClass: "execute",
    nowMs: Date.now()
  });
  assert.equal(eligibleNow.eligible, true);
  const stale = registry.dispatchEligibility({
    nodeId: "node:test-3",
    requiredSandboxMode: "restricted_remote",
    requiredActionClass: "execute",
    nowMs: Date.now() + 1_000
  });
  assert.equal(stale.eligible, false);
  assert.equal(stale.reasonCode, "HEARTBEAT_STALE");
});

test("quarantine and revoke prevent eligibility", () => {
  const registry = new NodeRegistry(30_000);
  const nowIso = new Date().toISOString();
  registry.registerPairing(
    {
      nodeId: "node:test-4",
      nodeClass: "trusted_personal_node",
      tenantId: "tenant-local",
      workspaceId: "workspace-local",
      principalId: "node:node:test-4",
      attestation: attestation(nowIso),
      requestedCapabilities: capabilities(),
      nowIso
    },
    "pair-token-4",
    Date.now() + 60_000
  );
  registry.completePairing({
    nodeId: "node:test-4",
    pairingTokenId: "pair-token-4",
    nowIso
  });
  registry.recordHeartbeat(
    {
      nodeId: "node:test-4",
      nowIso,
      status: "healthy",
      runtimeVersion: "node-agent/1.0.0",
      load: { activeRuns: 0, cpuPct: 10, memoryPct: 20 },
      attestationFresh: true
    },
    trace()
  );
  registry.quarantineNode({
    nodeId: "node:test-4",
    reason: "attestation mismatch",
    nowIso
  });
  const quarantined = registry.dispatchEligibility({
    nodeId: "node:test-4",
    requiredSandboxMode: "restricted_remote",
    requiredActionClass: "execute"
  });
  assert.equal(quarantined.eligible, false);
  registry.revokeNode({
    nodeId: "node:test-4",
    reason: "compromised",
    nowIso
  });
  const revoked = registry.getNode("node:test-4");
  assert.equal(revoked?.status, "revoked");
});
