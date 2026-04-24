/**
 * In-memory plugin registry.
 *
 * Tracks all registered plugins, their lifecycle state, granted capabilities,
 * and revocation records.
 *
 * Milestone 13+ path: replace in-memory store with durable persistence
 * (e.g. Postgres or a dedicated state store) so state survives restarts.
 */

import { randomUUID } from "node:crypto";

import {
  type PluginManifest,
  type PluginRegistryEntry,
  type PluginLifecycleState,
  type PluginCapabilityGrant,
  type PluginProvenanceVerificationResult,
  type PrincipalReference,
  buildPluginPrincipalId,
  PLUGIN_CONTRACT_VERSION
} from "@manasvi/contracts";

export class PluginRegistry {
  private readonly entries = new Map<string, PluginRegistryEntry>();

  // ── Registration ──────────────────────────────────────────────────────────

  register(manifest: PluginManifest): PluginRegistryEntry {
    const existing = this.entries.get(manifest.pluginId);
    if (existing) {
      if (existing.lifecycleState === "revoked") {
        throw new Error(
          `Plugin '${manifest.pluginId}' is revoked and cannot be re-registered. ` +
            `Create a new plugin ID for the replacement.`
        );
      }
    }

    const now = new Date().toISOString();
    const entry: PluginRegistryEntry = {
      schemaVersion: PLUGIN_CONTRACT_VERSION,
      pluginId: manifest.pluginId,
      version: manifest.version,
      manifest,
      principalId: buildPluginPrincipalId(manifest.pluginId, manifest.version),
      lifecycleState: "discovered",
      grantedCapabilities: [],
      deniedCapabilityIds: [],
      provenanceVerified: false,
      registeredAt: now,
      updatedAt: now
    };

    this.entries.set(manifest.pluginId, entry);
    return entry;
  }

  // ── Getters ───────────────────────────────────────────────────────────────

  get(pluginId: string): PluginRegistryEntry | undefined {
    return this.entries.get(pluginId);
  }

  getOrThrow(pluginId: string): PluginRegistryEntry {
    const entry = this.entries.get(pluginId);
    if (!entry) {
      throw new Error(`Plugin '${pluginId}' not found in registry`);
    }
    return entry;
  }

  list(): PluginRegistryEntry[] {
    return [...this.entries.values()];
  }

  // ── State transitions ─────────────────────────────────────────────────────

  transitionState(pluginId: string, newState: PluginLifecycleState): PluginRegistryEntry {
    const entry = this.getOrThrow(pluginId);

    if (entry.lifecycleState === "revoked" && newState !== "revoked") {
      throw new Error(`Plugin '${pluginId}' is revoked and cannot transition to '${newState}'`);
    }

    const updated: PluginRegistryEntry = {
      ...entry,
      lifecycleState: newState,
      updatedAt: new Date().toISOString()
    };
    this.entries.set(pluginId, updated);
    return updated;
  }

  // ── Capability management ─────────────────────────────────────────────────

  setCapabilityGrants(
    pluginId: string,
    granted: PluginCapabilityGrant[],
    denied: string[]
  ): PluginRegistryEntry {
    const entry = this.getOrThrow(pluginId);
    const updated: PluginRegistryEntry = {
      ...entry,
      grantedCapabilities: granted,
      deniedCapabilityIds: denied,
      updatedAt: new Date().toISOString()
    };
    this.entries.set(pluginId, updated);
    return updated;
  }

  revokeCapabilityGrant(pluginId: string, grantId: string, reason: string): PluginRegistryEntry {
    const entry = this.getOrThrow(pluginId);
    const now = new Date().toISOString();
    const updatedGrants = entry.grantedCapabilities.map((g) =>
      g.grantId === grantId
        ? { ...g, revoked: true, revokedAt: now, revokedReason: reason }
        : g
    );
    const updated: PluginRegistryEntry = {
      ...entry,
      grantedCapabilities: updatedGrants,
      updatedAt: now
    };
    this.entries.set(pluginId, updated);
    return updated;
  }

  // ── Provenance ────────────────────────────────────────────────────────────

  recordProvenanceVerification(
    pluginId: string,
    result: PluginProvenanceVerificationResult
  ): PluginRegistryEntry {
    const entry = this.getOrThrow(pluginId);
    const updated: PluginRegistryEntry = {
      ...entry,
      provenanceVerified: result.verified,
      ...(result.note !== undefined ? { provenanceVerificationNote: result.note } : {}),
      updatedAt: new Date().toISOString()
    };
    this.entries.set(pluginId, updated);
    return updated;
  }

  // ── Revocation ────────────────────────────────────────────────────────────

  revoke(
    pluginId: string,
    revokedBy: PrincipalReference,
    reason: string
  ): PluginRegistryEntry {
    const entry = this.getOrThrow(pluginId);
    const now = new Date().toISOString();

    // Revoke all active capability grants
    const revokedGrants = entry.grantedCapabilities.map((g) =>
      g.revoked ? g : { ...g, revoked: true, revokedAt: now, revokedReason: "plugin revoked" }
    );

    const updated: PluginRegistryEntry = {
      ...entry,
      lifecycleState: "revoked",
      grantedCapabilities: revokedGrants,
      revocationRecord: { revokedAt: now, revokedBy, reason },
      updatedAt: now
    };
    this.entries.set(pluginId, updated);
    return updated;
  }

  // ── Checks ────────────────────────────────────────────────────────────────

  isRevoked(pluginId: string): boolean {
    const entry = this.entries.get(pluginId);
    return entry?.lifecycleState === "revoked";
  }

  isRunning(pluginId: string): boolean {
    const entry = this.entries.get(pluginId);
    return entry?.lifecycleState === "running";
  }

  hasGrantedCapability(pluginId: string, capabilityId: string): boolean {
    const entry = this.entries.get(pluginId);
    if (!entry) return false;
    return entry.grantedCapabilities.some(
      (g) => g.capabilityId === capabilityId && !g.revoked
    );
  }
}
