import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { validatePluginManifest } from "./plugin-manifest.js";

// ── Valid manifest fixture ────────────────────────────────────────────────────

const baseManifest = {
  manifestVersion: "1.0",
  pluginId: "com.example.test-plugin",
  name: "test-plugin",
  version: "0.1.0",
  publisher: "example-org",
  runtimeType: "node",
  entrypoint: "dist/plugin.js",
  supportedApiVersion: "1.0",
  riskClass: "low",
  requestedCapabilities: [
    {
      capabilityId: "test-plugin:provide-tools",
      family: "provide-tools",
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
  deprecationState: "active",
  tags: []
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("validatePluginManifest", () => {
  it("accepts a valid manifest", () => {
    const result = validatePluginManifest(baseManifest);
    assert.equal(result.ok, true);
    assert.ok(result.manifest);
    assert.equal(result.errors.length, 0);
  });

  it("rejects manifest with schema errors", () => {
    const result = validatePluginManifest({ ...baseManifest, pluginId: undefined });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.includes("[schema]")));
  });

  it("rejects manifest with unsupported API version", () => {
    const result = validatePluginManifest({ ...baseManifest, supportedApiVersion: "2.0" });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.includes("[version]") && e.includes("2.0")));
  });

  it("rejects privileged plugin where capability lacks justification", () => {
    const manifest = {
      ...baseManifest,
      riskClass: "privileged",
      requestedCapabilities: [
        {
          capabilityId: "test-plugin:provide-tools",
          family: "provide-tools",
          scope: {},
          required: true
          // no justification
        }
      ]
    };
    const result = validatePluginManifest(manifest);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.includes("[risk]") && e.includes("justification")));
  });

  it("rejects manifest requesting provide-tools but declaring no tools", () => {
    const manifest = {
      ...baseManifest,
      providedTools: []
    };
    const result = validatePluginManifest(manifest);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.includes("[coherence]") && e.includes("provide-tools")));
  });

  it("rejects manifest requesting provide-hooks but declaring no hooks", () => {
    const manifest = {
      ...baseManifest,
      requestedCapabilities: [
        ...baseManifest.requestedCapabilities,
        {
          capabilityId: "test-plugin:provide-hooks",
          family: "provide-hooks",
          scope: {},
          required: true
        }
      ],
      providedHooks: []
    };
    const result = validatePluginManifest(manifest);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.includes("[coherence]") && e.includes("provide-hooks")));
  });

  it("rejects manifest with duplicate tool IDs", () => {
    const manifest = {
      ...baseManifest,
      providedTools: [
        ...baseManifest.providedTools,
        {
          toolId: "test.echo", // duplicate
          name: "echo2",
          description: "Another echo",
          inputSchema: {},
          outputSchema: {},
          sideEffects: [],
          requiresApproval: false
        }
      ]
    };
    const result = validatePluginManifest(manifest);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.includes("Duplicate tool IDs")));
  });

  it("emits a warning (not error) for disabled manifest with tools", () => {
    const manifest = { ...baseManifest, enabled: false };
    const result = validatePluginManifest(manifest);
    // [warn] entries don't fail — but they appear in errors array
    assert.ok(result.errors.some((e) => e.includes("[warn]")));
  });

  it("accepts manifest without any requestedCapabilities", () => {
    const manifest = {
      ...baseManifest,
      requestedCapabilities: [],
      providedTools: []
    };
    const result = validatePluginManifest(manifest);
    assert.equal(result.ok, true);
  });

  it("accepts manifest with provide-hooks and declared hooks", () => {
    const manifest = {
      ...baseManifest,
      requestedCapabilities: [
        ...baseManifest.requestedCapabilities,
        {
          capabilityId: "test-plugin:provide-hooks",
          family: "provide-hooks",
          scope: {},
          required: false
        }
      ],
      providedHooks: [
        {
          hookId: "test.on-message",
          name: "on-message",
          triggerEvent: "ingress.external_message.received"
        }
      ]
    };
    const result = validatePluginManifest(manifest);
    assert.equal(result.ok, true);
  });
});
