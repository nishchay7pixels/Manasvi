/**
 * Plugin lifecycle manager.
 *
 * Orchestrates the full lifecycle of a plugin from discovery through revocation.
 * This is the main coordination layer — it delegates to registry, capability approver,
 * provenance verifier, and plugin host.
 *
 * Lifecycle states (explicit, not convention-based):
 *
 *   discovered       → manifest received but not yet validated
 *   validated        → manifest passed all validation checks
 *   pending_approval → capabilities require explicit operator approval
 *   approved         → capability grants resolved; ready to load
 *   denied           → capability approval denied for all required capabilities
 *   loading          → plugin process being launched; handshake pending
 *   running          → handshake complete; plugin active
 *   unhealthy        → health check failures detected; may auto-restart
 *   stopped          → plugin process terminated cleanly
 *   failed           → plugin process exited unexpectedly or handshake failed
 *   revoked          → plugin explicitly revoked; cannot be restarted
 *   disabled         → plugin disabled by operator; can be re-enabled
 */

import { randomUUID } from "node:crypto";
import { createLogger, type Logger } from "@manasvi/logging";

import {
  type PluginManifest,
  type PluginCapabilityGrant,
  type PrincipalReference,
  type PluginLifecycleEvent,
  type PluginLifecycleState,
  createPluginLifecycleEvent,
  computeManifestHash
} from "@manasvi/contracts";

import { validatePluginManifest } from "./plugin-manifest.js";
import { verifyPluginProvenance, type ProvenanceVerifierOptions } from "./provenance.js";
import { PluginRegistry } from "./plugin-registry.js";
import { CapabilityApprover } from "./capability-approver.js";
import { PluginHost } from "./plugin-host.js";
import { pickFreePort } from "./util.js";

// ─── Lifecycle manager ────────────────────────────────────────────────────────

export interface PluginLifecycleManagerOptions {
  registry: PluginRegistry;
  approver: CapabilityApprover;
  host: PluginHost;
  provenanceOptions: ProvenanceVerifierOptions;
  hostRpcUrl: string;
  pluginBaseDir: string;
  onLifecycleEvent?: (event: PluginLifecycleEvent) => void;
}

export class PluginLifecycleManager {
  private readonly registry: PluginRegistry;
  private readonly approver: CapabilityApprover;
  private readonly host: PluginHost;
  private readonly provenanceOptions: ProvenanceVerifierOptions;
  private readonly hostRpcUrl: string;
  private readonly pluginBaseDir: string;
  private readonly onLifecycleEvent: ((event: PluginLifecycleEvent) => void) | undefined;
  private readonly logger: Logger;

  /** Pending handshakes: pluginId → { launchToken, resolve, reject, timer } */
  private readonly pendingHandshakes = new Map<
    string,
    {
      launchToken: string;
      resolve: () => void;
      reject: (reason: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();

  constructor(options: PluginLifecycleManagerOptions) {
    this.registry = options.registry;
    this.approver = options.approver;
    this.host = options.host;
    this.provenanceOptions = options.provenanceOptions;
    this.hostRpcUrl = options.hostRpcUrl;
    this.pluginBaseDir = options.pluginBaseDir;
    this.onLifecycleEvent = options.onLifecycleEvent;
    this.logger = createLogger({
      serviceName: "extension-runtime",
      serviceVersion: "0.1.0",
      environment: "local",
      level: "info",
      humanReadable: false
    });
  }

  // ── Registration ──────────────────────────────────────────────────────────

  /**
   * Register a plugin manifest. Performs manifest validation and provenance
   * verification. Transitions to `validated` or `pending_approval` state.
   */
  async register(rawManifest: unknown): Promise<{
    pluginId: string;
    state: PluginLifecycleState;
    errors: string[];
    requiresApproval: boolean;
  }> {
    const trace = this.makeTrace();

    // 1. Validate manifest
    const validation = validatePluginManifest(rawManifest);
    if (!validation.ok || !validation.manifest) {
      this.emit(
        createPluginLifecycleEvent({
          eventType: "plugin.manifest.rejected",
          pluginId: (rawManifest as Record<string, string>)["pluginId"] ?? "unknown",
          trace,
          detail: { errors: validation.errors }
        })
      );
      return {
        pluginId: (rawManifest as Record<string, string>)["pluginId"] ?? "unknown",
        state: "discovered",
        errors: validation.errors,
        requiresApproval: false
      };
    }

    const manifest = validation.manifest;

    // 2. Check for revoked plugin
    if (this.registry.isRevoked(manifest.pluginId)) {
      return {
        pluginId: manifest.pluginId,
        state: "revoked",
        errors: [`Plugin '${manifest.pluginId}' is revoked`],
        requiresApproval: false
      };
    }

    // 3. Register in registry (discovered state)
    const entry = this.registry.register(manifest);

    this.emit(
      createPluginLifecycleEvent({
        eventType: "plugin.discovered",
        pluginId: manifest.pluginId,
        pluginVersion: manifest.version,
        lifecycleState: "discovered",
        principalId: entry.principalId,
        trace
      })
    );

    // 4. Verify provenance
    const provenanceResult = verifyPluginProvenance(manifest, this.provenanceOptions);
    this.registry.recordProvenanceVerification(manifest.pluginId, provenanceResult);

    if (provenanceResult.verified) {
      this.emit(
        createPluginLifecycleEvent({
          eventType: "plugin.provenance.verified",
          pluginId: manifest.pluginId,
          pluginVersion: manifest.version,
          provenanceVerified: true,
          trace,
          detail: { method: provenanceResult.method, note: provenanceResult.note ?? "" }
        })
      );
    } else {
      this.emit(
        createPluginLifecycleEvent({
          eventType: "plugin.provenance.failed",
          pluginId: manifest.pluginId,
          pluginVersion: manifest.version,
          provenanceVerified: false,
          trace,
          detail: { method: provenanceResult.method, note: provenanceResult.note ?? "" }
        })
      );
    }

    // 5. Manifest validated
    this.registry.transitionState(manifest.pluginId, "validated");
    this.emit(
      createPluginLifecycleEvent({
        eventType: "plugin.manifest.validated",
        pluginId: manifest.pluginId,
        pluginVersion: manifest.version,
        lifecycleState: "validated",
        trace
      })
    );

    // 6. Evaluate capability requests
    const approvalResult = this.approver.evaluateRequests(manifest);

    this.emit(
      createPluginLifecycleEvent({
        eventType: "plugin.capability.requested",
        pluginId: manifest.pluginId,
        capabilityIds: manifest.requestedCapabilities.map((c) => c.capabilityId),
        trace
      })
    );

    if (!approvalResult.requiresExplicitApproval) {
      // Auto-approved
      this.registry.setCapabilityGrants(
        manifest.pluginId,
        approvalResult.granted,
        approvalResult.denied
      );
      this.registry.transitionState(manifest.pluginId, "approved");

      this.emit(
        createPluginLifecycleEvent({
          eventType: "plugin.capability.approved",
          pluginId: manifest.pluginId,
          capabilityIds: approvalResult.granted.map((g) => g.capabilityId),
          trace
        })
      );

      return {
        pluginId: manifest.pluginId,
        state: "approved",
        errors: [],
        requiresApproval: false
      };
    }

    // Requires explicit operator approval
    this.registry.transitionState(manifest.pluginId, "pending_approval");
    return {
      pluginId: manifest.pluginId,
      state: "pending_approval",
      errors: [],
      requiresApproval: true
    };
  }

  // ── Explicit operator approval ─────────────────────────────────────────────

  async approve(
    pluginId: string,
    approvedCapabilityIds: string[],
    approvedBy: PrincipalReference,
    policyRef?: string
  ): Promise<{ ok: boolean; error?: string }> {
    const entry = this.registry.get(pluginId);
    if (!entry) return { ok: false, error: `Plugin '${pluginId}' not found` };
    if (entry.lifecycleState === "revoked") {
      return { ok: false, error: `Plugin '${pluginId}' is revoked` };
    }
    if (entry.lifecycleState !== "pending_approval" && entry.lifecycleState !== "validated") {
      return {
        ok: false,
        error: `Plugin '${pluginId}' is in state '${entry.lifecycleState}', not eligible for approval`
      };
    }

    const trace = this.makeTrace();
    const result = this.approver.applyExplicitApproval(
      entry.manifest,
      approvedCapabilityIds,
      approvedBy,
      policyRef
    );

    this.registry.setCapabilityGrants(pluginId, result.granted, result.denied);

    if (result.denied.length > 0) {
      this.emit(
        createPluginLifecycleEvent({
          eventType: "plugin.capability.denied",
          pluginId,
          capabilityIds: result.denied,
          trace
        })
      );
    }

    const allRequiredDenied = entry.manifest.requestedCapabilities
      .filter((c) => c.required)
      .every((c) => result.denied.includes(c.capabilityId));

    if (allRequiredDenied && result.granted.length === 0) {
      this.registry.transitionState(pluginId, "denied");
      return { ok: false, error: `All required capabilities denied for plugin '${pluginId}'` };
    }

    this.registry.transitionState(pluginId, "approved");
    this.emit(
      createPluginLifecycleEvent({
        eventType: "plugin.capability.approved",
        pluginId,
        capabilityIds: result.granted.map((g) => g.capabilityId),
        ...(policyRef !== undefined ? { policyRef } : {}),
        trace
      })
    );

    return { ok: true };
  }

  // ── Start ─────────────────────────────────────────────────────────────────

  async start(
    pluginId: string,
    opts: { handshakeTimeoutMs: number; injectedSecretsEnv?: Record<string, string> }
  ): Promise<{ ok: boolean; error?: string }> {
    const entry = this.registry.get(pluginId);
    if (!entry) return { ok: false, error: `Plugin '${pluginId}' not found` };
    if (entry.lifecycleState === "revoked") {
      return { ok: false, error: `Plugin '${pluginId}' is revoked and cannot be started` };
    }
    if (entry.lifecycleState !== "approved") {
      return {
        ok: false,
        error: `Plugin '${pluginId}' must be in 'approved' state to start (is: '${entry.lifecycleState}')`
      };
    }
    if (this.host.isRunning(pluginId)) {
      return { ok: false, error: `Plugin '${pluginId}' is already running` };
    }

    const callbackPort = await pickFreePort();
    this.registry.transitionState(pluginId, "loading");

    try {
      const { launchToken } = await this.host.launch(entry.manifest, entry.grantedCapabilities, {
        callbackPort,
        pluginBaseDir: this.pluginBaseDir,
        ...(opts.injectedSecretsEnv ? { injectedEnv: opts.injectedSecretsEnv } : {})
      });

      // Wait for plugin to complete handshake
      await this.awaitHandshake(pluginId, launchToken, opts.handshakeTimeoutMs);

      this.registry.transitionState(pluginId, "running");
      this.host.startHealthChecks(pluginId);

      const trace = this.makeTrace();
      this.emit(
        createPluginLifecycleEvent({
          eventType: "plugin.started",
          pluginId,
          pluginVersion: entry.version,
          lifecycleState: "running",
          trace
        })
      );

      return { ok: true };
    } catch (error) {
      this.registry.transitionState(pluginId, "failed");
      return {
        ok: false,
        error: error instanceof Error ? error.message : "Plugin launch failed"
      };
    }
  }

  // ── Handshake (called by RPC server when plugin connects) ─────────────────

  /**
   * Process a plugin handshake request from the RPC server.
   * Validates: plugin registration, launch token, manifest hash, API version.
   * Resolves the pending handshake promise so `start()` can complete.
   */
  processHandshake(
    pluginId: string,
    incomingLaunchToken: string,
    manifestHash: string,
    callbackUrl: string,
    supportedApiVersion: string
  ): {
    ok: boolean;
    grants: PluginCapabilityGrant[];
    principalId: string;
    sessionToken: string;
    rejectionReason?: string;
  } {
    const trace = this.makeTrace();
    const entry = this.registry.get(pluginId);

    if (!entry) {
      this.emit(
        createPluginLifecycleEvent({
          eventType: "plugin.handshake.failed",
          pluginId,
          trace,
          detail: { reason: "not_registered" }
        })
      );
      return { ok: false, grants: [], principalId: "", sessionToken: "", rejectionReason: "Plugin not registered" };
    }

    if (entry.lifecycleState === "revoked") {
      this.emit(
        createPluginLifecycleEvent({
          eventType: "plugin.handshake.failed",
          pluginId,
          trace,
          detail: { reason: "revoked" }
        })
      );
      return { ok: false, grants: [], principalId: "", sessionToken: "", rejectionReason: "Plugin is revoked" };
    }

    // Verify launch token
    const pending = this.pendingHandshakes.get(pluginId);
    if (!pending || pending.launchToken !== incomingLaunchToken) {
      this.emit(
        createPluginLifecycleEvent({
          eventType: "plugin.handshake.failed",
          pluginId,
          trace,
          detail: { reason: "invalid_launch_token" }
        })
      );
      return { ok: false, grants: [], principalId: "", sessionToken: "", rejectionReason: "Invalid launch token" };
    }

    // Verify manifest hash
    const expectedHash = computeManifestHash(entry.manifest);
    if (manifestHash !== expectedHash) {
      pending.reject(new Error("Manifest hash mismatch during handshake"));
      this.pendingHandshakes.delete(pluginId);
      this.emit(
        createPluginLifecycleEvent({
          eventType: "plugin.handshake.failed",
          pluginId,
          trace,
          detail: { reason: "manifest_hash_mismatch", expected: expectedHash, received: manifestHash }
        })
      );
      return { ok: false, grants: [], principalId: "", sessionToken: "", rejectionReason: "Manifest hash mismatch" };
    }

    // Verify API version
    if (supportedApiVersion !== "1.0") {
      pending.reject(new Error(`Unsupported plugin API version: ${supportedApiVersion}`));
      this.pendingHandshakes.delete(pluginId);
      return { ok: false, grants: [], principalId: "", sessionToken: "", rejectionReason: `Unsupported API version: ${supportedApiVersion}` };
    }

    // Update callback URL in host
    this.host.updateCallbackUrl(pluginId, callbackUrl);

    // Generate session token for subsequent plugin → host RPC
    const sessionToken = randomUUID();

    // Resolve the pending handshake
    clearTimeout(pending.timer);
    pending.resolve();
    this.pendingHandshakes.delete(pluginId);

    this.emit(
      createPluginLifecycleEvent({
        eventType: "plugin.handshake.succeeded",
        pluginId,
        pluginVersion: entry.version,
        lifecycleState: "running",
        principalId: entry.principalId,
        capabilityIds: entry.grantedCapabilities.map((g) => g.capabilityId),
        trace
      })
    );

    return {
      ok: true,
      grants: entry.grantedCapabilities,
      principalId: entry.principalId,
      sessionToken
    };
  }

  // ── Stop ──────────────────────────────────────────────────────────────────

  async stop(pluginId: string): Promise<{ ok: boolean; error?: string }> {
    const entry = this.registry.get(pluginId);
    if (!entry) return { ok: false, error: `Plugin '${pluginId}' not found` };

    await this.host.stop(pluginId);
    this.registry.transitionState(pluginId, "stopped");

    const trace = this.makeTrace();
    this.emit(
      createPluginLifecycleEvent({
        eventType: "plugin.stopped",
        pluginId,
        lifecycleState: "stopped",
        trace
      })
    );

    return { ok: true };
  }

  // ── Revocation ────────────────────────────────────────────────────────────

  async revoke(
    pluginId: string,
    revokedBy: PrincipalReference,
    reason: string
  ): Promise<{ ok: boolean; error?: string }> {
    const entry = this.registry.get(pluginId);
    if (!entry) return { ok: false, error: `Plugin '${pluginId}' not found` };
    if (entry.lifecycleState === "revoked") {
      return { ok: false, error: `Plugin '${pluginId}' is already revoked` };
    }

    // Stop if running
    if (this.host.isRunning(pluginId)) {
      await this.host.stop(pluginId);
    }

    this.registry.revoke(pluginId, revokedBy, reason);

    const trace = this.makeTrace();
    this.emit(
      createPluginLifecycleEvent({
        eventType: "plugin.revoked",
        pluginId,
        lifecycleState: "revoked",
        principalId: entry.principalId,
        trace,
        detail: { reason, revokedBy: entry.principalId }
      })
    );

    return { ok: true };
  }

  // ── Handle unhealthy plugin ───────────────────────────────────────────────

  handleUnhealthy(pluginId: string): void {
    const entry = this.registry.get(pluginId);
    if (!entry) return;

    this.registry.transitionState(pluginId, "unhealthy");
    const trace = this.makeTrace();
    this.emit(
      createPluginLifecycleEvent({
        eventType: "plugin.unhealthy",
        pluginId,
        lifecycleState: "unhealthy",
        trace
      })
    );
    this.logger.warn("Plugin marked unhealthy", { pluginId });
  }

  handleProcessExit(pluginId: string, code: number | null): void {
    const entry = this.registry.get(pluginId);
    if (!entry) return;
    if (entry.lifecycleState === "stopped" || entry.lifecycleState === "revoked") return;

    this.registry.transitionState(pluginId, "failed");
    this.logger.error("Plugin process exited unexpectedly", { pluginId, code });
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private awaitHandshake(
    pluginId: string,
    launchToken: string,
    timeoutMs: number
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingHandshakes.delete(pluginId);
        reject(new Error(`Plugin '${pluginId}' handshake timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      this.pendingHandshakes.set(pluginId, { launchToken, resolve, reject, timer });
    });
  }

  private emit(event: PluginLifecycleEvent): void {
    this.logger.info("Plugin lifecycle event", {
      eventType: event.eventType,
      pluginId: event.pluginId,
      lifecycleState: event.lifecycleState ?? "unknown",
      traceId: event.trace.traceId
    });
    this.onLifecycleEvent?.(event);
  }

  private makeTrace() {
    return {
      traceId: randomUUID(),
      correlationId: randomUUID()
    };
  }
}
