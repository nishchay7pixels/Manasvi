import { randomUUID } from "node:crypto";

import { toolRegistryEntrySchema, type PrincipalReference, type ToolManifest, type ToolRegistryEntry } from "@manasvi/contracts";
import { BUILTIN_TOOL_MANIFESTS, validateToolManifest } from "@manasvi/tool-sdk";

export interface RegisterToolInput {
  manifest: ToolManifest;
  registeredBy: PrincipalReference;
}

export interface ListToolsInput {
  status?: ToolRegistryEntry["status"];
  toolIdPrefix?: string;
  includeDeprecated?: boolean;
}

export interface ToolMetadataExplorerRecord {
  toolId: string;
  version: string;
  name: string;
  description: string;
  status: ToolRegistryEntry["status"];
  type: ToolManifest["type"];
  actionClass: ToolManifest["actionClass"];
  sideEffectClass: ToolManifest["sideEffectClass"];
  mutability: ToolManifest["mutability"];
  capabilities: string[];
  resourceClassesTouched: string[];
  policyBinding: ToolManifest["policyBinding"];
  runtimeHints: ToolManifest["runtimeHints"];
  trustNotes: string[];
  tags: string[];
  /** Human-readable risk posture summary derived from manifest fields. */
  riskSummary: {
    isReadOnly: boolean;
    isNetworkTouching: boolean;
    isMemoryMutating: boolean;
    isApprovalSensitive: boolean;
    approvalHint: "none" | "may_require" | "must_require";
    riskLabel: "low" | "medium" | "high";
  };
  registeredAt: string;
  updatedAt: string;
  owner: string;
  provider: string;
}

function registryKey(toolId: string, version: string): string {
  return `${toolId}@${version}`;
}

function toStatus(manifestStatus: ToolManifest["status"]): ToolRegistryEntry["status"] {
  if (manifestStatus === "enabled") {
    return "enabled";
  }
  if (manifestStatus === "disabled") {
    return "disabled";
  }
  return "deprecated";
}

export class InMemoryToolRegistry {
  private readonly entries = new Map<string, ToolRegistryEntry>();

  constructor(options?: { preloadBuiltIns?: boolean }) {
    if (options?.preloadBuiltIns !== false) {
      for (const manifest of BUILTIN_TOOL_MANIFESTS) {
        this.register({
          manifest,
          registeredBy: {
            principalId: "service:orchestrator-service",
            principalType: "service"
          }
        });
      }
    }
  }

  register(input: RegisterToolInput): ToolRegistryEntry {
    const manifest = validateToolManifest(input.manifest);
    const now = new Date().toISOString();
    const key = registryKey(manifest.toolId, manifest.version);
    const existing = this.entries.get(key);
    const entry = toolRegistryEntrySchema.parse({
      schemaVersion: "1.0",
      toolId: manifest.toolId,
      version: manifest.version,
      status: toStatus(manifest.status),
      registeredBy: input.registeredBy,
      registeredAt: existing?.registeredAt ?? now,
      updatedAt: now,
      manifest
    });
    this.entries.set(key, entry);
    return entry;
  }

  getByToolVersion(toolId: string, version: string): ToolRegistryEntry | undefined {
    return this.entries.get(registryKey(toolId, version));
  }

  getLatest(toolId: string): ToolRegistryEntry | undefined {
    const candidates = Array.from(this.entries.values()).filter((entry) => entry.toolId === toolId);
    if (candidates.length === 0) {
      return undefined;
    }
    return candidates.sort((left, right) => right.version.localeCompare(left.version))[0];
  }

  resolve(toolId: string, version?: string): ToolRegistryEntry | undefined {
    if (version) {
      return this.getByToolVersion(toolId, version);
    }
    return this.getLatest(toolId);
  }

  list(input?: ListToolsInput): ToolRegistryEntry[] {
    return Array.from(this.entries.values()).filter((entry) => {
      if (input?.status && entry.status !== input.status) {
        return false;
      }
      if (!input?.includeDeprecated && entry.status === "deprecated") {
        return false;
      }
      if (input?.toolIdPrefix && !entry.toolId.startsWith(input.toolIdPrefix)) {
        return false;
      }
      return true;
    });
  }

  searchByTag(tag: string): ToolRegistryEntry[] {
    return Array.from(this.entries.values()).filter((entry) => entry.manifest.tags.includes(tag));
  }

  setStatus(input: { toolId: string; version: string; status: ToolRegistryEntry["status"] }): ToolRegistryEntry {
    const existing = this.getByToolVersion(input.toolId, input.version);
    if (!existing) {
      throw new Error(`Tool ${input.toolId}@${input.version} is not registered`);
    }
    const now = new Date().toISOString();
    const manifestStatus =
      input.status === "enabled" ? "enabled" : input.status === "disabled" ? "disabled" : "deprecated";
    const next = toolRegistryEntrySchema.parse({
      ...existing,
      status: input.status,
      updatedAt: now,
      manifest: {
        ...existing.manifest,
        status: manifestStatus,
        ...(input.status === "deprecated" && !existing.manifest.deprecatedAt ? { deprecatedAt: now } : {}),
        updatedAt: now
      }
    });
    this.entries.set(registryKey(input.toolId, input.version), next);
    return next;
  }

  metadataExplorer(input?: ListToolsInput): ToolMetadataExplorerRecord[] {
    return this.list(input).map((entry) => {
      const m = entry.manifest;
      const isNetworkTouching = m.resourceClassesTouched.includes("network-zone");
      const isMemoryMutating = m.actionClass === "mutate-memory" || m.sideEffectClass === "mutating";
      const isReadOnly = m.mutability === "read_only";
      const isApprovalSensitive = m.runtimeHints.approvalSensitive;
      const approvalHint = m.policyBinding.approvalHint;

      let riskLabel: "low" | "medium" | "high" = "low";
      if (isApprovalSensitive || approvalHint === "must_require") {
        riskLabel = "high";
      } else if (isNetworkTouching || isMemoryMutating || approvalHint === "may_require") {
        riskLabel = "medium";
      }

      return {
        toolId: entry.toolId,
        version: entry.version,
        name: m.name,
        description: m.description,
        status: entry.status,
        type: m.type,
        actionClass: m.actionClass,
        sideEffectClass: m.sideEffectClass,
        mutability: m.mutability,
        capabilities: m.capabilities.map((item) => item.capabilityId),
        resourceClassesTouched: m.resourceClassesTouched,
        policyBinding: m.policyBinding,
        runtimeHints: m.runtimeHints,
        trustNotes: m.trustNotes,
        tags: m.tags,
        riskSummary: {
          isReadOnly,
          isNetworkTouching,
          isMemoryMutating,
          isApprovalSensitive,
          approvalHint,
          riskLabel
        },
        registeredAt: entry.registeredAt,
        updatedAt: entry.updatedAt,
        owner: m.owner,
        provider: m.provider
      };
    });
  }

  count(): number {
    return this.entries.size;
  }

  issueInvocationCorrelationId(): string {
    return `tool-registry:${randomUUID()}`;
  }
}
