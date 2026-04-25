import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { NodeRegistry } from "../../../../apps/node-manager/src/node-registry.js";

import { assertNodeDispatchDenied } from "./oracles.js";

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
      maxConcurrentRuns: 1,
      constraints: {}
    }
  ];
}

test("[TB-NODE-001][node] impersonation attempt with wrong pairing token is rejected", () => {
  const registry = new NodeRegistry(30_000);
  const nowIso = new Date().toISOString();
  registry.registerPairing(
    {
      nodeId: "node:trusted-a",
      nodeClass: "restricted_utility_node",
      tenantId: "tenant-local",
      workspaceId: "workspace-local",
      principalId: "node:trusted-a",
      attestation: attestation(nowIso),
      requestedCapabilities: capabilities(),
      nowIso
    },
    "pair-token-correct",
    Date.now() + 60_000
  );
  const completion = registry.completePairing({
    nodeId: "node:trusted-a",
    pairingTokenId: "pair-token-forged",
    nowIso
  });
  assert.equal(completion, undefined);
});

test("[TB-NODE-001][node] quarantined and revoked nodes are ineligible for dispatch", () => {
  const registry = new NodeRegistry(30_000);
  const nowIso = new Date().toISOString();
  registry.registerPairing(
    {
      nodeId: "node:trusted-b",
      nodeClass: "trusted_personal_node",
      tenantId: "tenant-local",
      workspaceId: "workspace-local",
      principalId: "node:trusted-b",
      attestation: attestation(nowIso),
      requestedCapabilities: capabilities(),
      nowIso
    },
    "pair-token-b",
    Date.now() + 60_000
  );
  registry.completePairing({ nodeId: "node:trusted-b", pairingTokenId: "pair-token-b", nowIso });
  registry.recordHeartbeat(
    {
      nodeId: "node:trusted-b",
      nowIso,
      status: "healthy",
      runtimeVersion: "node-agent/1.0.0",
      load: { activeRuns: 0, cpuPct: 10, memoryPct: 20 },
      attestationFresh: true
    },
    trace()
  );
  registry.quarantineNode({
    nodeId: "node:trusted-b",
    reason: "attestation mismatch",
    nowIso
  });
  const quarantinedEligibility = registry.dispatchEligibility({
    nodeId: "node:trusted-b",
    requiredSandboxMode: "restricted_remote",
    requiredActionClass: "execute"
  });
  assertNodeDispatchDenied(quarantinedEligibility, "NODE_NOT_ACTIVE");

  registry.revokeNode({
    nodeId: "node:trusted-b",
    reason: "credential leakage",
    nowIso
  });
  const revokedEligibility = registry.dispatchEligibility({
    nodeId: "node:trusted-b",
    requiredSandboxMode: "restricted_remote",
    requiredActionClass: "execute"
  });
  assertNodeDispatchDenied(revokedEligibility, "NODE_NOT_ACTIVE");
});

test("[TB-NODE-001][node][control] active node with fresh heartbeat remains dispatch-eligible", () => {
  const registry = new NodeRegistry(30_000);
  const nowIso = new Date().toISOString();
  registry.registerPairing(
    {
      nodeId: "node:trusted-c",
      nodeClass: "restricted_utility_node",
      tenantId: "tenant-local",
      workspaceId: "workspace-local",
      principalId: "node:trusted-c",
      attestation: attestation(nowIso),
      requestedCapabilities: capabilities(),
      nowIso
    },
    "pair-token-c",
    Date.now() + 60_000
  );
  registry.completePairing({ nodeId: "node:trusted-c", pairingTokenId: "pair-token-c", nowIso });
  registry.recordHeartbeat(
    {
      nodeId: "node:trusted-c",
      nowIso,
      status: "healthy",
      runtimeVersion: "node-agent/1.0.0",
      load: { activeRuns: 0, cpuPct: 10, memoryPct: 20 },
      attestationFresh: true
    },
    trace()
  );
  const eligible = registry.dispatchEligibility({
    nodeId: "node:trusted-c",
    requiredSandboxMode: "restricted_remote",
    requiredActionClass: "execute"
  });
  assert.equal(eligible.eligible, true);
});
