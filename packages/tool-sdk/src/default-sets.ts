/**
 * Built-in default tool sets for Manasvi.
 *
 * A tool set is a named, curated group of tool IDs that an operator can
 * enable as a starting point. Each set has a clear risk posture and purpose.
 *
 * Tool sets do NOT grant policy permission automatically.
 * Policy rules in configs/policies/ still govern what is actually allowed.
 * Tool sets describe the intended enabled/disabled state of the tool registry.
 */

import type { BuiltInToolId } from "./index.js";

// ── Tool set definitions ───────────────────────────────────────────────────────

export interface ToolSetDefinition {
  /** Machine-readable identifier for the set. */
  setId: string;
  /** Human-readable display name. */
  name: string;
  /** One-line description of the set's purpose and risk posture. */
  description: string;
  /** Intended use cases for this set. */
  useCases: string[];
  /** Risk level of enabling this set as a whole. */
  riskLevel: "low" | "medium" | "high";
  /** Tools included in this set. */
  toolIds: BuiltInToolId[];
  /**
   * Whether any tool in this set requires explicit human approval for
   * individual invocations (beyond registration).
   */
  containsApprovalSensitiveTools: boolean;
  /**
   * Whether enabling this set requires the operator to configure additional
   * settings (e.g., egress allowlists, filesystem paths, API keys).
   */
  requiresOperatorConfig: boolean;
  /** Optional notes for the operator shown during setup. */
  operatorNotes: string[];
}

/**
 * STARTER_SAFE_SET — the recommended default starting point.
 *
 * Includes read and search capabilities only.
 * All network access is governed by the egress allowlist.
 * No writes to memory or the filesystem.
 * Suitable for agents that answer questions, fetch references, and summarize.
 */
export const STARTER_SAFE_SET: ToolSetDefinition = {
  setId: "manasvi.toolset.starter-safe",
  name: "Starter Safe Set",
  description:
    "Read-only and search capabilities. Safe starting point for informational agents. " +
    "No memory writes, no shell access, no approval-gated actions.",
  useCases: [
    "Answer questions using web search",
    "Fetch and summarize remote documents",
    "Read local workspace files",
    "Informational assistants and research agents"
  ],
  riskLevel: "low",
  toolIds: [
    "tool.local-file-read",
    "tool.http-fetch",
    "tool.web-search"
  ],
  containsApprovalSensitiveTools: false,
  requiresOperatorConfig: true,
  operatorNotes: [
    "Configure egress allowlist in the execution-manager policy to restrict HTTP fetch and web search targets.",
    "Configure filesystem-zone read paths in policy to restrict which files can be read.",
    "Policy in configs/policies/default-policy-set.json must explicitly allow read, access-network, and search actions."
  ]
};

/**
 * NOTES_SET — adds note-writing capability to any base set.
 *
 * Allows agents to persist information in the governed memory namespace.
 * Trust classification is always preserved — no silent trust upgrade.
 * Combine with STARTER_SAFE_SET for a read+search+remember workflow.
 */
export const NOTES_SET: ToolSetDefinition = {
  setId: "manasvi.toolset.notes",
  name: "Notes Set",
  description:
    "Adds governed memory note writing. Agents can save facts, summaries, and session notes " +
    "into policy-scoped namespaces. Trust classification is always preserved.",
  useCases: [
    "Save facts discovered during research",
    "Create session notes and task summaries",
    "Store references for future retrieval",
    "Build up an agent knowledge base within a workspace"
  ],
  riskLevel: "medium",
  toolIds: [
    "tool.memory-note-write"
  ],
  containsApprovalSensitiveTools: false,
  requiresOperatorConfig: true,
  operatorNotes: [
    "Configure allowed memory namespaces in policy.",
    "Ensure mutate-memory action class is explicitly allowed for the relevant principal types.",
    "CONTROL_TRUSTED writes require additional policy rules."
  ]
};

/**
 * GOVERNED_ACTION_SET — approval-gated workflow tools.
 *
 * Adds the approval request tool. Enables agents to pause and route
 * actions that require human authorisation before proceeding.
 * This is Manasvi's primary human-in-the-loop governance mechanism.
 */
export const GOVERNED_ACTION_SET: ToolSetDefinition = {
  setId: "manasvi.toolset.governed-action",
  name: "Governed Action Set",
  description:
    "Approval-gated workflow tools. Enables agents to request human authorisation " +
    "before executing sensitive actions. Core to Manasvi's human-in-the-loop model.",
  useCases: [
    "Require human approval before executing high-risk actions",
    "Route ambiguous or sensitive decisions to an operator",
    "Provide visible accountability for agent actions",
    "Build approval-gated agentic workflows"
  ],
  riskLevel: "low",
  toolIds: [
    "tool.approval-request"
  ],
  containsApprovalSensitiveTools: true,
  requiresOperatorConfig: true,
  operatorNotes: [
    "Approval requests appear in the admin dashboard under the Approvals tab.",
    "Configure the approval service URL and approval TTL in the orchestrator config.",
    "The approve action class must be allowed in policy for the requesting principal."
  ]
};

/**
 * ALL_BUILTIN_SET — every built-in tool enabled.
 *
 * Includes shell command execution, which requires approval and
 * additional policy configuration. Only for advanced operator setups.
 * Do not use this as a default for untrusted workloads.
 */
export const ALL_BUILTIN_SET: ToolSetDefinition = {
  setId: "manasvi.toolset.all-builtin",
  name: "All Built-in Tools",
  description:
    "Every built-in tool, including shell command execution. " +
    "High-risk: requires approval configuration and explicit operator policy. " +
    "Not recommended as a default for untrusted workloads.",
  useCases: [
    "Full-capability operator-controlled agents",
    "Internal automation with human-in-the-loop approval",
    "Development and testing of tool governance"
  ],
  riskLevel: "high",
  toolIds: [
    "tool.local-file-read",
    "tool.http-fetch",
    "tool.web-search",
    "tool.memory-note-write",
    "tool.approval-request",
    "tool.shell-command"
  ],
  containsApprovalSensitiveTools: true,
  requiresOperatorConfig: true,
  operatorNotes: [
    "Shell command execution requires must_require approval policy.",
    "Configure the allowed command list carefully. Defaults to [echo, pwd, ls].",
    "Review all egress, filesystem, and memory policy rules before enabling."
  ]
};

// ── Default set catalogue ──────────────────────────────────────────────────────

/** All named tool sets, ordered by risk level. */
export const BUILTIN_TOOL_SETS: ToolSetDefinition[] = [
  STARTER_SAFE_SET,
  NOTES_SET,
  GOVERNED_ACTION_SET,
  ALL_BUILTIN_SET
];

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Returns the ToolSetDefinition for the given set ID, or undefined.
 */
export function getToolSet(setId: string): ToolSetDefinition | undefined {
  return BUILTIN_TOOL_SETS.find((s) => s.setId === setId);
}

/**
 * Returns the tool IDs that should be enabled for a given set, minus any
 * that are in the excludeIds list.
 */
export function resolveToolSetIds(
  set: ToolSetDefinition,
  options?: { excludeIds?: string[] }
): BuiltInToolId[] {
  const excluded = new Set(options?.excludeIds ?? []);
  return set.toolIds.filter((id) => !excluded.has(id));
}

/**
 * Returns a summary of a tool set suitable for display in the CLI or dashboard.
 */
export function describeToolSet(set: ToolSetDefinition): {
  setId: string;
  name: string;
  description: string;
  riskLevel: string;
  toolCount: number;
  toolIds: string[];
  containsApprovalSensitiveTools: boolean;
  requiresOperatorConfig: boolean;
} {
  return {
    setId: set.setId,
    name: set.name,
    description: set.description,
    riskLevel: set.riskLevel,
    toolCount: set.toolIds.length,
    toolIds: set.toolIds,
    containsApprovalSensitiveTools: set.containsApprovalSensitiveTools,
    requiresOperatorConfig: set.requiresOperatorConfig
  };
}
