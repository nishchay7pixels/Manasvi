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

// Re-export sub-specs for advanced consumers
export { RUNTIME_TOOL_SPECS } from "./tools/runtime.js";
export { FILESYSTEM_TOOL_SPECS } from "./tools/filesystem.js";
export { SESSION_TOOL_SPECS } from "./tools/sessions.js";
export { MEMORY_TOOL_SPECS } from "./tools/memory.js";
export { WEB_TOOL_SPECS } from "./tools/web.js";
export { UI_TOOL_SPECS } from "./tools/ui.js";
export { AUTOMATION_TOOL_SPECS } from "./tools/automation.js";
export { MESSAGING_TOOL_SPECS } from "./tools/messaging.js";
export { NODES_TOOL_SPECS } from "./tools/nodes.js";
export { AGENTS_TOOL_SPECS } from "./tools/agents.js";

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

/**
 * STARTER_READ_SET — full read-oriented capability, including sessions and memory.
 *
 * Extends STARTER_SAFE_SET with session inspection, memory read, agent listing,
 * and node inspection. Fully read-only with no write side effects.
 * Suitable for informational and research agents that need broader context access.
 */
export const STARTER_READ_SET: ToolSetDefinition = {
  setId: "manasvi.toolset.starter-read",
  name: "Starter Read Set",
  description:
    "Full read-only capability surface. Includes file read, web search, HTTP fetch, " +
    "memory search/get, sessions inspection, agent listing, and node inspection. " +
    "No writes, no execution. Ideal as a broad informational baseline.",
  useCases: [
    "Research and summarisation agents",
    "Session and workspace inspection",
    "Agent capability discovery",
    "Read-only monitoring agents"
  ],
  riskLevel: "low",
  toolIds: [
    "tool.local-file-read",
    "tool.http-fetch",
    "tool.web-search",
    "tool.x-search",
    "tool.memory-get",
    "tool.memory-search",
    "tool.agents-list",
    "tool.sessions-list",
    "tool.sessions-history",
    "tool.session-status",
    "tool.nodes"
  ],
  containsApprovalSensitiveTools: false,
  requiresOperatorConfig: true,
  operatorNotes: [
    "Configure egress allowlist for web-search, http-fetch, and x-search.",
    "Configure memory namespace read policy.",
    "x-search requires secret:x-api-key configured in the secrets service."
  ]
};

/**
 * CONTROLLED_WRITE_SET — governed write capability for filesystem and sessions.
 *
 * Adds file writing, editing, and session communication tools.
 * No execution or external side effects. Suitable for agents that produce outputs.
 */
export const CONTROLLED_WRITE_SET: ToolSetDefinition = {
  setId: "manasvi.toolset.controlled-write",
  name: "Controlled Write Set",
  description:
    "Controlled write capability: file write/edit, session send, canvas rendering, " +
    "and messaging. No shell execution. Suitable for agents that produce structured outputs.",
  useCases: [
    "Document and report generation",
    "Session management and workflow continuation",
    "Operator notification via messaging",
    "Dashboard canvas rendering"
  ],
  riskLevel: "medium",
  toolIds: [
    "tool.file-write",
    "tool.file-edit",
    "tool.sessions-send",
    "tool.sessions-yield",
    "tool.canvas",
    "tool.message"
  ],
  containsApprovalSensitiveTools: false,
  requiresOperatorConfig: true,
  operatorNotes: [
    "Configure filesystem write zone paths in policy.",
    "Configure allowed messaging channels in the channel adapter.",
    "Approval may be triggered depending on operator policy configuration."
  ]
};

/**
 * GOVERNED_EXECUTE_SET — high-risk execution surface with mandatory approval.
 *
 * Adds shell execution (exec, bash, code-execution, process) and file patching.
 * All tools in this set require approval by default.
 * Only for trusted operator-controlled workflows.
 */
export const GOVERNED_EXECUTE_SET: ToolSetDefinition = {
  setId: "manasvi.toolset.governed-execute",
  name: "Governed Execute Set",
  description:
    "High-risk execution tools with mandatory approval gates. " +
    "Includes exec, bash, code-execution, process management, and apply-patch. " +
    "All invocations require approval. For operator-controlled trusted workflows only.",
  useCases: [
    "CI/CD pipeline execution",
    "Automated code build and test",
    "Controlled shell scripting",
    "Code patching workflows"
  ],
  riskLevel: "high",
  toolIds: [
    "tool.exec",
    "tool.bash",
    "tool.code-execution",
    "tool.process",
    "tool.file-apply-patch",
    "tool.approval-request"
  ],
  containsApprovalSensitiveTools: true,
  requiresOperatorConfig: true,
  operatorNotes: [
    "All tools in this set require must_require approval policy.",
    "Configure sandbox execution policy and resource limits.",
    "Review audit trail after each execution session."
  ]
};

/**
 * WORKFLOW_OPERATOR_SET — operator-level automation and integration surface.
 *
 * Adds cron scheduling, gateway integration, subagent spawning, and session management.
 * High-privilege. Only for trusted operator-controlled automation.
 */
export const WORKFLOW_OPERATOR_SET: ToolSetDefinition = {
  setId: "manasvi.toolset.workflow-operator",
  name: "Workflow / Operator Set",
  description:
    "Operator-level automation surface: cron scheduling, gateway integration, " +
    "subagent spawning, session creation, and browser. " +
    "Requires explicit operator policy. All approval-sensitive operations gated.",
  useCases: [
    "Automated scheduled workflows",
    "External system integration via gateway",
    "Multi-agent orchestration",
    "Browser-based data extraction"
  ],
  riskLevel: "high",
  toolIds: [
    "tool.cron",
    "tool.gateway",
    "tool.subagents",
    "tool.sessions-spawn",
    "tool.browser",
    "tool.approval-request"
  ],
  containsApprovalSensitiveTools: true,
  requiresOperatorConfig: true,
  operatorNotes: [
    "All tools require operator-configured policy rules.",
    "Gateway endpoints must be registered by the operator.",
    "Browser requires provisioned headless browser runtime.",
    "Cron jobs execute under the creating principal's policy constraints."
  ]
};

/**
 * FS1_SAFE_READ_SET — Milestone FS1 safe read-only filesystem tools.
 *
 * All tools are workspace-sandboxed: paths must be inside MANASVI_WORKSPACE_ROOT.
 * Sensitive files and directories are blocked by server-side deny patterns.
 * File size, directory entry count, and search results are all capped.
 * No writes, no shell access, no network. Fully read-only.
 *
 * Operators must:
 * 1. Set MANASVI_WORKSPACE_ROOT to the directory the agent should read from.
 * 2. Create the workspace directory.
 * 3. Add the FS1 policy rules from configs/policies/default-policy-set.json.
 */
export const FS1_SAFE_READ_SET: ToolSetDefinition = {
  setId: "manasvi.toolset.fs1-safe-read",
  name: "FS1 Safe Read Set",
  description:
    "Milestone FS1 safe read-only filesystem tools. " +
    "Workspace-sandboxed: all paths resolve within MANASVI_WORKSPACE_ROOT. " +
    "Sensitive files (.env, .pem, .key, .git, node_modules, etc.) are blocked by deny patterns. " +
    "No writes, no shell, no network. File size and result counts are capped.",
  useCases: [
    "Read and summarise files in a controlled workspace",
    "List workspace contents and navigate directory structure",
    "Search file contents for specific values or patterns",
    "Check file existence and metadata before reading"
  ],
  riskLevel: "low",
  toolIds: [
    "tool.fs-read-file",
    "tool.fs-list-directory",
    "tool.fs-stat",
    "tool.fs-search-files"
  ],
  containsApprovalSensitiveTools: false,
  requiresOperatorConfig: true,
  operatorNotes: [
    "Set MANASVI_WORKSPACE_ROOT to the directory the agent should read from (default: ./workspace).",
    "Create the workspace directory before starting the agent.",
    "Add the FS1 policy rules to configs/policies/default-policy-set.json.",
    "File system access is sandboxed — absolute paths and path traversal are blocked by the runtime.",
    "Deny patterns block: .env, .env.*, *.pem, *.key, *.crt, id_rsa, id_ed25519, .ssh/, .aws/, .gcp/, .azure/, .git/, node_modules/, dist/, build/, coverage/, .next/, .turbo/, .cache/"
  ]
};

// ── Default set catalogue ──────────────────────────────────────────────────────

/** All named tool sets, ordered by risk level. */
export const BUILTIN_TOOL_SETS: ToolSetDefinition[] = [
  STARTER_SAFE_SET,
  STARTER_READ_SET,
  FS1_SAFE_READ_SET,
  NOTES_SET,
  CONTROLLED_WRITE_SET,
  GOVERNED_ACTION_SET,
  GOVERNED_EXECUTE_SET,
  WORKFLOW_OPERATOR_SET,
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
