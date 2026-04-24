/**
 * Plugin capability request / approval flow.
 *
 * Capability approval is the formal gate between a plugin's declared requests and
 * what it actually receives at runtime.
 *
 * Approval paths:
 * 1. Auto-approval — only for low-risk plugins with low-risk capabilities when
 *    `requireExplicitCapabilityApproval` is false (local dev mode).
 * 2. Policy-gated approval — capability is evaluated against the Policy Service.
 * 3. Explicit operator approval — operator calls POST /plugins/:id/approve with
 *    the approved capability set. Used when explicit approval is required.
 *
 * No capability is ever self-granted by the plugin.
 * Denied capabilities are recorded alongside granted ones.
 */

import { randomUUID } from "node:crypto";

import {
  type PluginManifest,
  type PluginCapabilityRequest,
  type PluginCapabilityGrant,
  type PluginCapabilityFamily,
  type PrincipalReference,
  createCapabilityGrant
} from "@manasvi/contracts";

export interface CapabilityApprovalResult {
  granted: PluginCapabilityGrant[];
  denied: string[];
  requiresExplicitApproval: boolean;
}

// ── Risk scoring ─────────────────────────────────────────────────────────────

const CAPABILITY_RISK: Record<PluginCapabilityFamily, "low" | "medium" | "high"> = {
  "provide-tools": "low",
  "provide-hooks": "low",
  "access-network": "high",
  "access-filesystem": "high",
  "access-secret": "high",
  "publish-events": "medium",
  "consume-events": "medium",
  "request-sandboxed-execution": "medium"
};

function capabilityRiskLevel(family: PluginCapabilityFamily): "low" | "medium" | "high" {
  return CAPABILITY_RISK[family] ?? "high";
}

// ── Auto-approval eligibility ─────────────────────────────────────────────────

/**
 * Returns true only when all conditions are met:
 * - Plugin risk class is "low"
 * - Capability risk level is "low"
 * - No network, filesystem, or secret access is requested
 * - Explicit approval is not required by config
 */
function isAutoApprovalEligible(
  manifest: PluginManifest,
  cap: PluginCapabilityRequest,
  requireExplicitApproval: boolean
): boolean {
  if (requireExplicitApproval) return false;
  if (manifest.riskClass !== "low") return false;
  if (capabilityRiskLevel(cap.family) !== "low") return false;
  return true;
}

// ── Approver ──────────────────────────────────────────────────────────────────

export interface CapabilityApproverOptions {
  requireExplicitCapabilityApproval: boolean;
  /** Principal representing the approval authority (system or operator). */
  approvalAuthority: PrincipalReference;
}

export class CapabilityApprover {
  constructor(private readonly options: CapabilityApproverOptions) {}

  /**
   * Evaluate capability requests for a plugin at registration / approval time.
   *
   * Returns:
   * - `granted`: capability grants approved in this pass
   * - `denied`: capability IDs that were denied
   * - `requiresExplicitApproval`: true if operator must call POST /plugins/:id/approve
   */
  evaluateRequests(manifest: PluginManifest): CapabilityApprovalResult {
    const granted: PluginCapabilityGrant[] = [];
    const denied: string[] = [];
    let requiresExplicitApproval = false;

    for (const cap of manifest.requestedCapabilities) {
      const eligible = isAutoApprovalEligible(
        manifest,
        cap,
        this.options.requireExplicitCapabilityApproval
      );

      if (eligible) {
        granted.push(
          createCapabilityGrant({
            capabilityId: cap.capabilityId,
            family: cap.family,
            pluginId: manifest.pluginId,
            scope: cap.scope,
            grantedBy: this.options.approvalAuthority,
            policyRef: "auto-approval:low-risk-local-dev"
          })
        );
      } else {
        // Requires explicit operator approval or policy evaluation
        requiresExplicitApproval = true;
      }
    }

    return { granted, denied, requiresExplicitApproval };
  }

  /**
   * Apply an explicit operator-provided capability approval.
   *
   * The operator supplies the set of capability IDs they are granting.
   * Capabilities not in the approved set are denied.
   * Capabilities not in the manifest are silently ignored.
   */
  applyExplicitApproval(
    manifest: PluginManifest,
    approvedCapabilityIds: string[],
    approvedBy: PrincipalReference,
    policyRef?: string
  ): CapabilityApprovalResult {
    const approved = new Set(approvedCapabilityIds);
    const granted: PluginCapabilityGrant[] = [];
    const denied: string[] = [];

    for (const cap of manifest.requestedCapabilities) {
      if (approved.has(cap.capabilityId)) {
        granted.push(
          createCapabilityGrant({
            capabilityId: cap.capabilityId,
            family: cap.family,
            pluginId: manifest.pluginId,
            scope: cap.scope,
            grantedBy: approvedBy,
            ...(policyRef !== undefined ? { policyRef } : {})
          })
        );
      } else {
        denied.push(cap.capabilityId);
      }
    }

    return { granted, denied, requiresExplicitApproval: false };
  }

  /**
   * Verify that a runtime capability use is backed by an active (non-revoked) grant.
   * Used by the RPC server before forwarding tool invocations.
   */
  isCapabilityGranted(
    grants: PluginCapabilityGrant[],
    capabilityId: string
  ): boolean {
    return grants.some((g) => g.capabilityId === capabilityId && !g.revoked);
  }

  /**
   * Verify that the plugin is permitted to provide a specific tool.
   * Requires an active "provide-tools" grant.
   */
  canProvideTools(grants: PluginCapabilityGrant[]): boolean {
    return this.isCapabilityGranted(grants, this.findGrantIdForFamily(grants, "provide-tools"));
  }

  private findGrantIdForFamily(
    grants: PluginCapabilityGrant[],
    family: PluginCapabilityFamily
  ): string {
    const grant = grants.find((g) => g.family === family && !g.revoked);
    return grant?.capabilityId ?? "";
  }
}
