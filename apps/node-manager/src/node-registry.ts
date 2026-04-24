import { createHash } from "node:crypto";

import {
  nodeAttestationMetadataSchema,
  nodeCapabilitySchema,
  nodeClassSchema,
  nodeHeartbeatSchema,
  nodeIdentitySchema,
  type NodeAttestationMetadata,
  type NodeCapability,
  type NodeClass,
  type NodeHeartbeat,
  type NodeIdentity,
  type NodeStatus
} from "@manasvi/contracts";
import { z } from "zod";

interface PairingState {
  nodeId: string;
  pairingTokenId: string;
  expiresAtMs: number;
}

export interface PairingInput {
  nodeId: string;
  nodeClass: NodeClass;
  tenantId: string;
  workspaceId: string;
  principalId: string;
  ownerPrincipal?: NodeIdentity["ownerPrincipal"];
  attestation: NodeAttestationMetadata;
  requestedCapabilities: NodeCapability[];
  nowIso: string;
}

export interface PairingCompletionInput {
  nodeId: string;
  pairingTokenId: string;
  nowIso: string;
  attestation?: NodeAttestationMetadata;
  capabilities?: NodeCapability[];
  agentEndpoint?: string;
}

export interface HeartbeatInput {
  nodeId: string;
  nowIso: string;
  status: NodeHeartbeat["status"];
  runtimeVersion: string;
  load: NodeHeartbeat["load"];
  attestationFresh: boolean;
}

export interface DispatchEligibility {
  eligible: boolean;
  reasonCode?: string;
  reason?: string;
}

interface NodeRuntimeState {
  identity: NodeIdentity;
  pairing: PairingState | undefined;
  capabilityHash: string;
  agentEndpoint: string | undefined;
  lastHeartbeat: NodeHeartbeat | undefined;
}

function capabilityHash(capabilities: NodeCapability[]): string {
  const stable = JSON.stringify(
    capabilities
      .map((item) => nodeCapabilitySchema.parse(item))
      .sort((a, b) => a.capabilityId.localeCompare(b.capabilityId))
  );
  return createHash("sha256").update(stable, "utf8").digest("hex");
}

function inferRiskLevel(nodeClass: NodeClass): NodeIdentity["riskLevel"] {
  switch (nodeClass) {
    case "local_node":
      return "medium";
    case "trusted_personal_node":
      return "medium";
    case "restricted_utility_node":
      return "high";
    case "high_risk_isolated_node":
      return "critical";
    default:
      return "medium";
  }
}

export class NodeRegistry {
  private readonly nodes = new Map<string, NodeRuntimeState>();

  constructor(private readonly heartbeatStaleMs: number) {}

  listNodes(nowMs = Date.now()): NodeIdentity[] {
    return [...this.nodes.values()].map((entry) => this.projectIdentity(entry, nowMs));
  }

  getNode(nodeId: string, nowMs = Date.now()): NodeIdentity | undefined {
    const entry = this.nodes.get(nodeId);
    if (!entry) {
      return undefined;
    }
    return this.projectIdentity(entry, nowMs);
  }

  registerPairing(input: PairingInput, pairingTokenId: string, expiresAtMs: number): NodeIdentity {
    const nowMs = Date.parse(input.nowIso);
    const nodeClass = nodeClassSchema.parse(input.nodeClass);
    const attestation = nodeAttestationMetadataSchema.parse(input.attestation);
    const capabilities = input.requestedCapabilities.map((item) => nodeCapabilitySchema.parse(item));
    const identity = nodeIdentitySchema.parse({
      schemaVersion: "1.0",
      contractVersion: "1.0.0",
      nodeId: input.nodeId,
      principal: {
        principalId: input.principalId,
        principalType: "execution_node"
      },
      nodeClass,
      status: "pending_pairing",
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      ...(input.ownerPrincipal ? { ownerPrincipal: input.ownerPrincipal } : {}),
      attestation,
      capabilities,
      riskLevel: inferRiskLevel(nodeClass),
      quarantined: false,
      revoked: false,
      createdAt: input.nowIso,
      updatedAt: input.nowIso,
      labels: []
    });
    this.nodes.set(input.nodeId, {
      identity,
      capabilityHash: capabilityHash(capabilities),
      agentEndpoint: undefined,
      lastHeartbeat: undefined,
      pairing: {
        nodeId: input.nodeId,
        pairingTokenId,
        expiresAtMs
      }
    });
    return this.projectIdentity(this.nodes.get(input.nodeId)!, nowMs);
  }

  completePairing(input: PairingCompletionInput): NodeIdentity | undefined {
    const nowMs = Date.parse(input.nowIso);
    const current = this.nodes.get(input.nodeId);
    if (!current || !current.pairing) {
      return undefined;
    }
    if (current.pairing.pairingTokenId !== input.pairingTokenId || current.pairing.expiresAtMs < nowMs) {
      return undefined;
    }
    const attestation = input.attestation
      ? nodeAttestationMetadataSchema.parse(input.attestation)
      : current.identity.attestation;
    const capabilities = input.capabilities
      ? input.capabilities.map((item) => nodeCapabilitySchema.parse(item))
      : current.identity.capabilities;
    current.identity = nodeIdentitySchema.parse({
      ...current.identity,
      status: "active",
      pairedAt: input.nowIso,
      attestation,
      capabilities,
      updatedAt: input.nowIso
    });
    current.capabilityHash = capabilityHash(capabilities);
    current.pairing = undefined;
    if (typeof input.agentEndpoint === "string") {
      current.agentEndpoint = input.agentEndpoint;
    }
    this.nodes.set(input.nodeId, current);
    return this.projectIdentity(current, nowMs);
  }

  updateCapabilities(nodeId: string, capabilities: NodeCapability[], nowIso: string): NodeIdentity | undefined {
    const current = this.nodes.get(nodeId);
    if (!current) {
      return undefined;
    }
    const parsed = capabilities.map((item) => nodeCapabilitySchema.parse(item));
    current.identity = nodeIdentitySchema.parse({
      ...current.identity,
      capabilities: parsed,
      updatedAt: nowIso
    });
    current.capabilityHash = capabilityHash(parsed);
    this.nodes.set(nodeId, current);
    return this.projectIdentity(current);
  }

  recordHeartbeat(input: HeartbeatInput, trace: NodeHeartbeat["trace"]): NodeIdentity | undefined {
    const current = this.nodes.get(input.nodeId);
    if (!current) {
      return undefined;
    }
    const heartbeat = nodeHeartbeatSchema.parse({
      heartbeatId: `heartbeat:${Date.now()}:${Math.random().toString(16).slice(2, 8)}`,
      nodeId: input.nodeId,
      timestamp: input.nowIso,
      status: input.status,
      runtimeVersion: input.runtimeVersion,
      load: input.load,
      attestationFresh: input.attestationFresh,
      capabilityHash: current.capabilityHash,
      trace
    });
    const nextStatus: NodeStatus = current.identity.status === "revoked" ? "revoked" : "active";
    current.lastHeartbeat = heartbeat;
    current.identity = nodeIdentitySchema.parse({
      ...current.identity,
      status: nextStatus,
      heartbeatStatus: heartbeat.status,
      lastHeartbeatAt: heartbeat.timestamp,
      heartbeatStale: false,
      updatedAt: input.nowIso
    });
    this.nodes.set(input.nodeId, current);
    return this.projectIdentity(current, Date.parse(input.nowIso));
  }

  quarantineNode(input: {
    nodeId: string;
    reason: string;
    nowIso: string;
  }): NodeIdentity | undefined {
    const current = this.nodes.get(input.nodeId);
    if (!current) {
      return undefined;
    }
    current.identity = nodeIdentitySchema.parse({
      ...current.identity,
      status: "quarantined",
      quarantined: true,
      quarantineReason: input.reason,
      quarantineAt: input.nowIso,
      updatedAt: input.nowIso
    });
    this.nodes.set(input.nodeId, current);
    return this.projectIdentity(current);
  }

  revokeNode(input: {
    nodeId: string;
    reason: string;
    nowIso: string;
  }): NodeIdentity | undefined {
    const current = this.nodes.get(input.nodeId);
    if (!current) {
      return undefined;
    }
    current.identity = nodeIdentitySchema.parse({
      ...current.identity,
      status: "revoked",
      revoked: true,
      revokedReason: input.reason,
      revokedAt: input.nowIso,
      updatedAt: input.nowIso
    });
    this.nodes.set(input.nodeId, current);
    return this.projectIdentity(current);
  }

  dispatchEligibility(input: {
    nodeId: string;
    requiredSandboxMode: z.infer<typeof nodeCapabilitySchema.shape.supportedSandboxModes>[number];
    requiredActionClass: z.infer<typeof nodeCapabilitySchema.shape.actionClasses>[number];
    nowMs?: number;
  }): DispatchEligibility {
    const current = this.nodes.get(input.nodeId);
    if (!current) {
      return {
        eligible: false,
        reasonCode: "NODE_NOT_FOUND",
        reason: "Node is not registered"
      };
    }
    const identity = this.projectIdentity(current, input.nowMs ?? Date.now());
    if (identity.status !== "active") {
      return {
        eligible: false,
        reasonCode: "NODE_NOT_ACTIVE",
        reason: `Node status is ${identity.status}`
      };
    }
    if (identity.heartbeatStale) {
      return {
        eligible: false,
        reasonCode: "HEARTBEAT_STALE",
        reason: "Node heartbeat is stale"
      };
    }
    const supportsMode = identity.capabilities.some((cap) =>
      cap.supportedSandboxModes.includes(input.requiredSandboxMode)
    );
    if (!supportsMode) {
      return {
        eligible: false,
        reasonCode: "SANDBOX_MODE_UNSUPPORTED",
        reason: `Node does not support sandbox mode ${input.requiredSandboxMode}`
      };
    }
    const supportsAction = identity.capabilities.some((cap) =>
      cap.actionClasses.includes(input.requiredActionClass)
    );
    if (!supportsAction) {
      return {
        eligible: false,
        reasonCode: "ACTION_CLASS_UNSUPPORTED",
        reason: `Node does not support action class ${input.requiredActionClass}`
      };
    }
    return { eligible: true };
  }

  getAgentEndpoint(nodeId: string): string | undefined {
    return this.nodes.get(nodeId)?.agentEndpoint;
  }

  private projectIdentity(entry: NodeRuntimeState, nowMs = Date.now()): NodeIdentity {
    const lastHeartbeatMs = entry.identity.lastHeartbeatAt ? Date.parse(entry.identity.lastHeartbeatAt) : undefined;
    const stale = typeof lastHeartbeatMs === "number" ? nowMs - lastHeartbeatMs > this.heartbeatStaleMs : true;
    return nodeIdentitySchema.parse({
      ...entry.identity,
      heartbeatStale: stale
    });
  }
}
