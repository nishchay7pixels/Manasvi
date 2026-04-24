import { strict as assert } from "node:assert";
import { describe, it, beforeEach } from "node:test";

import { PluginRegistry } from "./plugin-registry.js";
import { CapabilityApprover } from "./capability-approver.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const authority = {
  principalId: "service:extension-runtime",
  principalType: "service" as const
};

const lowRiskManifest = {
  manifestVersion: "1.0" as const,
  pluginId: "com.example.lifecycle-test",
  name: "lifecycle-test-plugin",
  version: "0.1.0",
  publisher: "example",
  runtimeType: "node" as const,
  entrypoint: "plugin.js",
  supportedApiVersion: "1.0",
  riskClass: "low" as const,
  requestedCapabilities: [
    {
      capabilityId: "lifecycle-test:provide-tools",
      family: "provide-tools" as const,
      scope: {},
      required: true
    }
  ],
  providedTools: [
    {
      toolId: "lt.echo",
      name: "echo",
      description: "echo",
      inputSchema: {},
      outputSchema: {},
      sideEffects: [],
      requiresApproval: false
    }
  ],
  providedHooks: [],
  requiredSecretRefs: [],
  requiredNetworkDomains: [],
  requiredFilesystemZones: [],
  enabled: true,
  deprecationState: "active" as const,
  tags: []
};

// ── Plugin Registry tests ─────────────────────────────────────────────────────

describe("PluginRegistry", () => {
  let registry: PluginRegistry;

  beforeEach(() => {
    registry = new PluginRegistry();
  });

  it("registers a plugin in discovered state", () => {
    const entry = registry.register(lowRiskManifest as Parameters<typeof registry.register>[0]);
    assert.equal(entry.lifecycleState, "discovered");
    assert.equal(entry.pluginId, lowRiskManifest.pluginId);
    assert.match(entry.principalId, /^plugin:com.example.lifecycle-test@0.1.0$/);
  });

  it("rejects re-registration of a revoked plugin", () => {
    registry.register(lowRiskManifest as Parameters<typeof registry.register>[0]);
    registry.revoke(lowRiskManifest.pluginId, authority, "test");

    assert.throws(
      () => registry.register(lowRiskManifest as Parameters<typeof registry.register>[0]),
      /revoked/
    );
  });

  it("transitions lifecycle state correctly", () => {
    registry.register(lowRiskManifest as Parameters<typeof registry.register>[0]);
    const updated = registry.transitionState(lowRiskManifest.pluginId, "validated");
    assert.equal(updated.lifecycleState, "validated");
  });

  it("prevents state transitions on revoked plugin", () => {
    registry.register(lowRiskManifest as Parameters<typeof registry.register>[0]);
    registry.revoke(lowRiskManifest.pluginId, authority, "test");

    assert.throws(
      () => registry.transitionState(lowRiskManifest.pluginId, "running"),
      /revoked/
    );
  });

  it("records provenance verification result", () => {
    registry.register(lowRiskManifest as Parameters<typeof registry.register>[0]);
    const updated = registry.recordProvenanceVerification(lowRiskManifest.pluginId, {
      verified: true,
      method: "hash-check",
      verifiedAt: new Date().toISOString(),
      note: "test"
    });
    assert.equal(updated.provenanceVerified, true);
    assert.equal(updated.provenanceVerificationNote, "test");
  });

  it("revokes plugin and marks all grants as revoked", () => {
    registry.register(lowRiskManifest as Parameters<typeof registry.register>[0]);
    registry.setCapabilityGrants(
      lowRiskManifest.pluginId,
      [
        {
          grantId: "grant:test1",
          capabilityId: "lifecycle-test:provide-tools",
          family: "provide-tools" as const,
          pluginId: lowRiskManifest.pluginId,
          scope: {},
          constraints: {},
          grantedBy: authority,
          grantedAt: new Date().toISOString(),
          revoked: false
        }
      ],
      []
    );

    const revoked = registry.revoke(lowRiskManifest.pluginId, authority, "test revocation");

    assert.equal(revoked.lifecycleState, "revoked");
    assert.ok(revoked.revocationRecord);
    assert.equal(revoked.revocationRecord.reason, "test revocation");
    assert.equal(revoked.grantedCapabilities[0]?.revoked, true);
  });

  it("checks isRevoked correctly", () => {
    registry.register(lowRiskManifest as Parameters<typeof registry.register>[0]);
    assert.equal(registry.isRevoked(lowRiskManifest.pluginId), false);

    registry.revoke(lowRiskManifest.pluginId, authority, "test");
    assert.equal(registry.isRevoked(lowRiskManifest.pluginId), true);
  });

  it("returns undefined for unknown plugin", () => {
    const entry = registry.get("com.unknown.plugin");
    assert.equal(entry, undefined);
  });

  it("throws on getOrThrow for unknown plugin", () => {
    assert.throws(() => registry.getOrThrow("com.unknown.plugin"), /not found/);
  });

  it("lists all registered plugins", () => {
    registry.register(lowRiskManifest as Parameters<typeof registry.register>[0]);
    const list = registry.list();
    assert.equal(list.length, 1);
    assert.equal(list[0]?.pluginId, lowRiskManifest.pluginId);
  });

  it("checks hasGrantedCapability correctly", () => {
    registry.register(lowRiskManifest as Parameters<typeof registry.register>[0]);
    assert.equal(
      registry.hasGrantedCapability(lowRiskManifest.pluginId, "lifecycle-test:provide-tools"),
      false
    );

    registry.setCapabilityGrants(
      lowRiskManifest.pluginId,
      [
        {
          grantId: "grant:t1",
          capabilityId: "lifecycle-test:provide-tools",
          family: "provide-tools" as const,
          pluginId: lowRiskManifest.pluginId,
          scope: {},
          constraints: {},
          grantedBy: authority,
          grantedAt: new Date().toISOString(),
          revoked: false
        }
      ],
      []
    );

    assert.equal(
      registry.hasGrantedCapability(lowRiskManifest.pluginId, "lifecycle-test:provide-tools"),
      true
    );
  });
});

// ── Plugin revocation is structural ──────────────────────────────────────────

describe("Revocation semantics", () => {
  it("revoked plugin cannot be re-registered or restarted", () => {
    const registry = new PluginRegistry();
    registry.register(lowRiskManifest as Parameters<typeof registry.register>[0]);
    registry.revoke(lowRiskManifest.pluginId, authority, "security incident");

    assert.equal(registry.isRevoked(lowRiskManifest.pluginId), true);

    // Re-registration must be rejected
    assert.throws(
      () => registry.register(lowRiskManifest as Parameters<typeof registry.register>[0]),
      /revoked/
    );

    // State transition must be rejected
    assert.throws(
      () => registry.transitionState(lowRiskManifest.pluginId, "running"),
      /revoked/
    );
  });

  it("revocation record contains who revoked and why", () => {
    const registry = new PluginRegistry();
    registry.register(lowRiskManifest as Parameters<typeof registry.register>[0]);

    const revoked = registry.revoke(lowRiskManifest.pluginId, authority, "policy violation");

    assert.ok(revoked.revocationRecord);
    assert.equal(revoked.revocationRecord.reason, "policy violation");
    assert.deepEqual(revoked.revocationRecord.revokedBy, authority);
    assert.ok(revoked.revocationRecord.revokedAt);
  });
});

// ── Capability grant lifecycle ────────────────────────────────────────────────

describe("Capability grant revocation", () => {
  it("individual grants can be revoked without revoking the plugin", () => {
    const registry = new PluginRegistry();
    registry.register(lowRiskManifest as Parameters<typeof registry.register>[0]);

    const grant = {
      grantId: "grant:individual-1",
      capabilityId: "lifecycle-test:provide-tools",
      family: "provide-tools" as const,
      pluginId: lowRiskManifest.pluginId,
      scope: {},
      constraints: {},
      grantedBy: authority,
      grantedAt: new Date().toISOString(),
      revoked: false
    };

    registry.setCapabilityGrants(lowRiskManifest.pluginId, [grant], []);
    assert.equal(
      registry.hasGrantedCapability(lowRiskManifest.pluginId, "lifecycle-test:provide-tools"),
      true
    );

    registry.revokeCapabilityGrant(lowRiskManifest.pluginId, "grant:individual-1", "misuse");

    assert.equal(
      registry.hasGrantedCapability(lowRiskManifest.pluginId, "lifecycle-test:provide-tools"),
      false
    );

    // Plugin itself is not revoked
    assert.equal(registry.isRevoked(lowRiskManifest.pluginId), false);
  });
});
