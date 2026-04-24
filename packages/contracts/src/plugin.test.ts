import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  pluginManifestSchema,
  pluginCapabilityGrantSchema,
  pluginHandshakeRequestSchema,
  pluginHandshakeResponseSchema,
  pluginRegistryEntrySchema,
  pluginLifecycleEventSchema,
  computeManifestHash,
  buildPluginPrincipalId,
  parsePluginManifest,
  createCapabilityGrant,
  createPluginLifecycleEvent,
  PLUGIN_CONTRACT_VERSION
} from "./plugin.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const validManifest = {
  manifestVersion: "1.0" as const,
  pluginId: "com.example.test-plugin",
  name: "test-plugin",
  version: "0.1.0",
  publisher: "example-org",
  runtimeType: "node" as const,
  entrypoint: "dist/plugin.js",
  supportedApiVersion: "1.0",
  riskClass: "low" as const,
  requestedCapabilities: [
    {
      capabilityId: "test-plugin:provide-tools",
      family: "provide-tools" as const,
      scope: {},
      required: true
    }
  ],
  providedTools: [
    {
      toolId: "test.echo",
      name: "echo",
      description: "Echoes input",
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
  tags: [],
  requestedCapabilities_: undefined
};

const validGrantedBy = {
  principalId: "service:extension-runtime",
  principalType: "service" as const
};

const validTrace = {
  traceId: "550e8400-e29b-41d4-a716-446655440000",
  correlationId: "550e8400-e29b-41d4-a716-446655440001"
};

// ── Plugin manifest schema ────────────────────────────────────────────────────

describe("pluginManifestSchema", () => {
  it("accepts a valid manifest", () => {
    const result = pluginManifestSchema.safeParse(validManifest);
    assert.equal(result.success, true);
  });

  it("rejects manifest with missing pluginId", () => {
    const result = pluginManifestSchema.safeParse({ ...validManifest, pluginId: undefined });
    assert.equal(result.success, false);
  });

  it("rejects manifest with invalid pluginId format", () => {
    const result = pluginManifestSchema.safeParse({
      ...validManifest,
      pluginId: "INVALID PLUGIN ID"
    });
    assert.equal(result.success, false);
  });

  it("rejects manifest with unknown riskClass", () => {
    const result = pluginManifestSchema.safeParse({ ...validManifest, riskClass: "extreme" });
    assert.equal(result.success, false);
  });

  it("rejects manifest with unknown runtimeType", () => {
    const result = pluginManifestSchema.safeParse({ ...validManifest, runtimeType: "jvm" });
    assert.equal(result.success, false);
  });

  it("rejects manifest with wrong manifestVersion", () => {
    const result = pluginManifestSchema.safeParse({ ...validManifest, manifestVersion: "2.0" });
    assert.equal(result.success, false);
  });

  it("accepts all valid riskClass values", () => {
    for (const riskClass of ["low", "medium", "high", "privileged"] as const) {
      const result = pluginManifestSchema.safeParse({ ...validManifest, riskClass });
      assert.equal(result.success, true, `riskClass '${riskClass}' should be valid`);
    }
  });

  it("defaults enabled to true", () => {
    const result = pluginManifestSchema.safeParse({ ...validManifest, enabled: undefined });
    assert.equal(result.success, true);
    if (result.success) assert.equal(result.data.enabled, true);
  });
});

// ── parsePluginManifest ───────────────────────────────────────────────────────

describe("parsePluginManifest", () => {
  it("returns a parsed manifest for valid input", () => {
    const manifest = parsePluginManifest(validManifest);
    assert.equal(manifest.pluginId, validManifest.pluginId);
    assert.equal(manifest.version, validManifest.version);
  });

  it("throws a descriptive error for invalid input", () => {
    assert.throws(
      () => parsePluginManifest({ manifestVersion: "1.0", pluginId: "bad id!" }),
      /Invalid plugin manifest/
    );
  });
});

// ── computeManifestHash ───────────────────────────────────────────────────────

describe("computeManifestHash", () => {
  it("produces a deterministic hex string", () => {
    const manifest = parsePluginManifest(validManifest);
    const h1 = computeManifestHash(manifest);
    const h2 = computeManifestHash(manifest);
    assert.equal(h1, h2);
    assert.match(h1, /^[0-9a-f]{64}$/);
  });

  it("produces different hashes for different manifests", () => {
    const m1 = parsePluginManifest(validManifest);
    const m2 = parsePluginManifest({ ...validManifest, version: "0.2.0" });
    assert.notEqual(computeManifestHash(m1), computeManifestHash(m2));
  });
});

// ── buildPluginPrincipalId ────────────────────────────────────────────────────

describe("buildPluginPrincipalId", () => {
  it("formats the principal ID correctly", () => {
    const id = buildPluginPrincipalId("com.example.my-plugin", "1.0.0");
    assert.equal(id, "plugin:com.example.my-plugin@1.0.0");
  });
});

// ── createCapabilityGrant ─────────────────────────────────────────────────────

describe("createCapabilityGrant", () => {
  it("produces a valid grant", () => {
    const grant = createCapabilityGrant({
      capabilityId: "test-plugin:provide-tools",
      family: "provide-tools",
      pluginId: "com.example.test-plugin",
      grantedBy: validGrantedBy
    });

    assert.match(grant.grantId, /^grant:/);
    assert.equal(grant.revoked, false);
    assert.equal(grant.family, "provide-tools");
    assert.equal(grant.pluginId, "com.example.test-plugin");
  });

  it("creates a revocable grant that can be marked revoked", () => {
    const grant = createCapabilityGrant({
      capabilityId: "test:cap",
      family: "provide-tools",
      pluginId: "com.example.test-plugin",
      grantedBy: validGrantedBy
    });
    const revoked = { ...grant, revoked: true, revokedAt: new Date().toISOString(), revokedReason: "test" };
    assert.equal(revoked.revoked, true);
  });
});

// ── pluginCapabilityGrantSchema ───────────────────────────────────────────────

describe("pluginCapabilityGrantSchema", () => {
  it("validates a well-formed grant", () => {
    const now = new Date().toISOString();
    const result = pluginCapabilityGrantSchema.safeParse({
      grantId: "grant:abc123",
      capabilityId: "test:cap",
      family: "provide-tools",
      pluginId: "com.example.test",
      scope: {},
      constraints: {},
      grantedBy: validGrantedBy,
      grantedAt: now,
      revoked: false
    });
    assert.equal(result.success, true);
  });

  it("rejects grant with unknown capability family", () => {
    const now = new Date().toISOString();
    const result = pluginCapabilityGrantSchema.safeParse({
      grantId: "grant:abc",
      capabilityId: "test:cap",
      family: "do-anything",
      pluginId: "com.example.test",
      scope: {},
      constraints: {},
      grantedBy: validGrantedBy,
      grantedAt: now,
      revoked: false
    });
    assert.equal(result.success, false);
  });
});

// ── pluginHandshakeRequestSchema ──────────────────────────────────────────────

describe("pluginHandshakeRequestSchema", () => {
  it("accepts a valid handshake request", () => {
    const result = pluginHandshakeRequestSchema.safeParse({
      protocolVersion: "1.0",
      pluginId: "com.example.test-plugin",
      pluginVersion: "0.1.0",
      manifestHash: "a".repeat(64),
      requestedCapabilities: [],
      providedTools: [],
      supportedApiVersion: "1.0",
      callbackUrl: "http://127.0.0.1:9999",
      timestamp: new Date().toISOString(),
      nonce: "abcdef0123456789"
    });
    assert.equal(result.success, true);
  });

  it("rejects handshake with short nonce", () => {
    const result = pluginHandshakeRequestSchema.safeParse({
      protocolVersion: "1.0",
      pluginId: "com.example.test-plugin",
      pluginVersion: "0.1.0",
      manifestHash: "a".repeat(64),
      requestedCapabilities: [],
      providedTools: [],
      supportedApiVersion: "1.0",
      callbackUrl: "http://127.0.0.1:9999",
      timestamp: new Date().toISOString(),
      nonce: "tooshort"
    });
    assert.equal(result.success, false);
  });

  it("rejects handshake with invalid callbackUrl", () => {
    const result = pluginHandshakeRequestSchema.safeParse({
      protocolVersion: "1.0",
      pluginId: "com.example.test-plugin",
      pluginVersion: "0.1.0",
      manifestHash: "a".repeat(64),
      requestedCapabilities: [],
      providedTools: [],
      supportedApiVersion: "1.0",
      callbackUrl: "not-a-url",
      timestamp: new Date().toISOString(),
      nonce: "abcdef0123456789"
    });
    assert.equal(result.success, false);
  });
});

// ── createPluginLifecycleEvent ────────────────────────────────────────────────

describe("createPluginLifecycleEvent", () => {
  it("creates a valid lifecycle event", () => {
    const event = createPluginLifecycleEvent({
      eventType: "plugin.discovered",
      pluginId: "com.example.test-plugin",
      trace: validTrace
    });

    assert.equal(event.schemaVersion, PLUGIN_CONTRACT_VERSION);
    assert.match(event.eventId, /^plugin-event:/);
    assert.equal(event.eventType, "plugin.discovered");
    assert.equal(event.pluginId, "com.example.test-plugin");
    assert.equal(event.trace.traceId, validTrace.traceId);
  });

  it("includes optional fields when provided", () => {
    const event = createPluginLifecycleEvent({
      eventType: "plugin.capability.approved",
      pluginId: "com.example.test-plugin",
      trace: validTrace,
      capabilityIds: ["cap1", "cap2"],
      lifecycleState: "approved",
      principalId: "plugin:com.example.test-plugin@0.1.0"
    });

    assert.deepEqual(event.capabilityIds, ["cap1", "cap2"]);
    assert.equal(event.lifecycleState, "approved");
    assert.equal(event.principalId, "plugin:com.example.test-plugin@0.1.0");
  });
});

// ── pluginLifecycleEventSchema ────────────────────────────────────────────────

describe("pluginLifecycleEventSchema", () => {
  it("rejects an event with unknown event type", () => {
    const result = pluginLifecycleEventSchema.safeParse({
      schemaVersion: "1.0",
      eventId: "plugin-event:abc",
      eventType: "plugin.something.made.up",
      pluginId: "com.example.test",
      capabilityIds: [],
      detail: {},
      trace: validTrace,
      timestamp: new Date().toISOString()
    });
    assert.equal(result.success, false);
  });
});
