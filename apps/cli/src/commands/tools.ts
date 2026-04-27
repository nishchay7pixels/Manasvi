/**
 * manasvi tools <list|inspect|sets>
 *
 * Shows the governed built-in tool registry with risk, policy, and governance
 * information. Fetches live data from the orchestrator when running;
 * falls back to static manifest data otherwise.
 *
 * Usage:
 *   pnpm manasvi tools list              — list all tools with status
 *   pnpm manasvi tools list --enabled    — only enabled tools
 *   pnpm manasvi tools list --disabled   — only disabled tools
 *   pnpm manasvi tools inspect <tool-id> — full governance details
 *   pnpm manasvi tools sets              — list available default tool sets
 */

import { banner, section, info, warn, hint, table, style, sym } from "../lib/ui.js";
import { loadConfig } from "../lib/config.js";
import { isPortInUse } from "../lib/health.js";

// ── Types (mirror ToolMetadataExplorerRecord from tool-registry) ───────────────

interface RiskSummary {
  isReadOnly: boolean;
  isNetworkTouching: boolean;
  isMemoryMutating: boolean;
  isApprovalSensitive: boolean;
  approvalHint: "none" | "may_require" | "must_require";
  riskLabel: "low" | "medium" | "high";
}

interface PolicyBinding {
  policyActionClass: string;
  resource: { resourceClass: string; resourceId: string };
  requiresExplicitPolicy: boolean;
  approvalHint: "none" | "may_require" | "must_require";
}

interface RuntimeHints {
  defaultTimeoutMs: number;
  defaultSandboxMode: string;
  egressProfiles: string[];
  filesystemProfile: string;
  declaredSecretRefs: string[];
  requireExecutorPath: boolean;
  approvalSensitive: boolean;
}

interface ToolEntry {
  toolId: string;
  name: string;
  version: string;
  description: string;
  status: string;
  type: string;
  actionClass: string;
  sideEffectClass: string;
  mutability: string;
  capabilities: string[];
  resourceClassesTouched: string[];
  policyBinding: PolicyBinding;
  runtimeHints: RuntimeHints;
  trustNotes: string[];
  tags: string[];
  riskSummary: RiskSummary;
  registeredAt?: string;
  updatedAt?: string;
  owner?: string;
  provider?: string;
}

// ── Static manifest fallback ───────────────────────────────────────────────────
// Used when the orchestrator is not running. Mirrors the built-in tool specs.

const STATIC_TOOLS: ToolEntry[] = [
  {
    toolId: "tool.local-file-read",
    name: "Local File Read",
    version: "1.0.0",
    description:
      "Reads a local file within the sandboxed workspace and returns its content. " +
      "Read-only, filesystem-zone scoped, output is EXTERNAL_UNTRUSTED.",
    status: "enabled",
    type: "built_in",
    actionClass: "read",
    sideEffectClass: "read_only",
    mutability: "read_only",
    capabilities: ["filesystem.read"],
    resourceClassesTouched: ["filesystem-zone"],
    policyBinding: {
      policyActionClass: "read",
      resource: { resourceClass: "filesystem-zone", resourceId: "filesystem:workspace" },
      requiresExplicitPolicy: true,
      approvalHint: "none"
    },
    runtimeHints: {
      defaultTimeoutMs: 8000,
      defaultSandboxMode: "read_only_local",
      egressProfiles: [],
      filesystemProfile: "read_only_inputs",
      declaredSecretRefs: [],
      requireExecutorPath: true,
      approvalSensitive: false
    },
    trustNotes: [
      "File content is EXTERNAL_UNTRUSTED by default.",
      "Path traversal outside sandbox-allowed zones is blocked at runtime.",
      "Read-only mode: no writes permitted."
    ],
    tags: ["filesystem", "read-only", "safe-default"],
    riskSummary: {
      isReadOnly: true,
      isNetworkTouching: false,
      isMemoryMutating: false,
      isApprovalSensitive: false,
      approvalHint: "none",
      riskLabel: "low"
    }
  },
  {
    toolId: "tool.http-fetch",
    name: "HTTP Fetch",
    version: "1.0.0",
    description:
      "Fetches content from a remote HTTP/HTTPS URL under egress-controlled runtime policy. " +
      "Only GET requests. Response is EXTERNAL_UNTRUSTED.",
    status: "enabled",
    type: "built_in",
    actionClass: "fetch",
    sideEffectClass: "external_side_effect",
    mutability: "read_only",
    capabilities: ["network.fetch"],
    resourceClassesTouched: ["network-zone"],
    policyBinding: {
      policyActionClass: "access-network",
      resource: { resourceClass: "network-zone", resourceId: "network:egress" },
      requiresExplicitPolicy: true,
      approvalHint: "may_require"
    },
    runtimeHints: {
      defaultTimeoutMs: 15000,
      defaultSandboxMode: "restricted_remote",
      egressProfiles: ["default-allowlist"],
      filesystemProfile: "none",
      declaredSecretRefs: [],
      requireExecutorPath: true,
      approvalSensitive: false
    },
    trustNotes: [
      "Remote content is EXTERNAL_UNTRUSTED.",
      "Egress restricted to operator allowlist; blocked destinations fail with NETWORK_EGRESS_BLOCKED.",
      "Only GET requests allowed."
    ],
    tags: ["network", "fetch", "external", "safe-default"],
    riskSummary: {
      isReadOnly: true,
      isNetworkTouching: true,
      isMemoryMutating: false,
      isApprovalSensitive: false,
      approvalHint: "may_require",
      riskLabel: "medium"
    }
  },
  {
    toolId: "tool.web-search",
    name: "Web Search",
    version: "1.0.0",
    description:
      "Performs a governed web search and returns structured results with provenance. " +
      "Results are EXTERNAL_UNTRUSTED. Uses the operator-configured search adapter.",
    status: "enabled",
    type: "adapter",
    actionClass: "search",
    sideEffectClass: "external_side_effect",
    mutability: "read_only",
    capabilities: ["web.search"],
    resourceClassesTouched: ["network-zone", "channel-surface"],
    policyBinding: {
      policyActionClass: "access-network",
      resource: { resourceClass: "network-zone", resourceId: "network:web-search" },
      requiresExplicitPolicy: true,
      approvalHint: "may_require"
    },
    runtimeHints: {
      defaultTimeoutMs: 18000,
      defaultSandboxMode: "restricted_remote",
      egressProfiles: ["default-allowlist"],
      filesystemProfile: "none",
      declaredSecretRefs: [],
      requireExecutorPath: true,
      approvalSensitive: false
    },
    trustNotes: [
      "Search results are EXTERNAL_UNTRUSTED.",
      "No credentials or private data are sent to the search engine.",
      "Egress restricted to operator allowlist."
    ],
    tags: ["search", "network", "external", "safe-default"],
    riskSummary: {
      isReadOnly: true,
      isNetworkTouching: true,
      isMemoryMutating: false,
      isApprovalSensitive: false,
      approvalHint: "may_require",
      riskLabel: "medium"
    }
  },
  {
    toolId: "tool.memory-note-write",
    name: "Note Write",
    version: "1.0.0",
    description:
      "Writes a note into a policy-governed memory namespace. Trust classification is always preserved. " +
      "No silent trust upgrades.",
    status: "enabled",
    type: "built_in",
    actionClass: "mutate-memory",
    sideEffectClass: "mutating",
    mutability: "mutating",
    capabilities: ["memory.write"],
    resourceClassesTouched: ["memory-namespace"],
    policyBinding: {
      policyActionClass: "mutate-memory",
      resource: { resourceClass: "memory-namespace", resourceId: "memory:notes" },
      requiresExplicitPolicy: true,
      approvalHint: "may_require"
    },
    runtimeHints: {
      defaultTimeoutMs: 8000,
      defaultSandboxMode: "read_only_local",
      egressProfiles: [],
      filesystemProfile: "scratch_write",
      declaredSecretRefs: [],
      requireExecutorPath: true,
      approvalSensitive: false
    },
    trustNotes: [
      "Trust classification is preserved as supplied; no silent upgrade.",
      "CONTROL_TRUSTED writes require explicit operator policy.",
      "Namespace scoping prevents cross-tenant contamination."
    ],
    tags: ["memory", "write", "notes"],
    riskSummary: {
      isReadOnly: false,
      isNetworkTouching: false,
      isMemoryMutating: true,
      isApprovalSensitive: false,
      approvalHint: "may_require",
      riskLabel: "medium"
    }
  },
  {
    toolId: "tool.approval-request",
    name: "Approval Request",
    version: "1.0.0",
    description:
      "Creates a cryptographically-bound approval request for a specific execution intent. " +
      "Routes to a human reviewer. Core governance primitive.",
    status: "enabled",
    type: "workflow",
    actionClass: "approve",
    sideEffectClass: "approval_sensitive",
    mutability: "mutating",
    capabilities: ["approval.request"],
    resourceClassesTouched: ["approval-authority", "service-endpoint"],
    policyBinding: {
      policyActionClass: "approve",
      resource: { resourceClass: "approval-authority", resourceId: "approval:default" },
      requiresExplicitPolicy: true,
      approvalHint: "must_require"
    },
    runtimeHints: {
      defaultTimeoutMs: 10000,
      defaultSandboxMode: "read_only_local",
      egressProfiles: [],
      filesystemProfile: "none",
      declaredSecretRefs: [],
      requireExecutorPath: true,
      approvalSensitive: true
    },
    trustNotes: [
      "Approval artifacts are cryptographically signed and bound to the intent payload hash.",
      "A rejected or expired approval does not allow execution to proceed.",
      "Visible in the admin dashboard and audit trail."
    ],
    tags: ["approval", "workflow", "governance"],
    riskSummary: {
      isReadOnly: false,
      isNetworkTouching: false,
      isMemoryMutating: false,
      isApprovalSensitive: true,
      approvalHint: "must_require",
      riskLabel: "high"
    }
  },
  {
    toolId: "tool.shell-command",
    name: "Shell Command",
    version: "1.0.0",
    description:
      "Executes bounded shell commands in a no-network sandbox. " +
      "High risk. Requires approval and explicit operator policy.",
    status: "enabled",
    type: "built_in",
    actionClass: "execute",
    sideEffectClass: "privileged",
    mutability: "mutating",
    capabilities: ["shell.execute"],
    resourceClassesTouched: ["filesystem-zone", "network-zone"],
    policyBinding: {
      policyActionClass: "execute",
      resource: { resourceClass: "tool-endpoint", resourceId: "tool:shell-command" },
      requiresExplicitPolicy: true,
      approvalHint: "must_require"
    },
    runtimeHints: {
      defaultTimeoutMs: 10000,
      defaultSandboxMode: "no_network_compute",
      egressProfiles: [],
      filesystemProfile: "scratch_write",
      declaredSecretRefs: [],
      requireExecutorPath: true,
      approvalSensitive: true
    },
    trustNotes: [
      "High-risk execution surface. Approval required by default.",
      "Command allowlist enforced by sandbox runtime.",
      "Network access blocked in no_network_compute mode."
    ],
    tags: ["shell", "execute", "privileged", "approval-required"],
    riskSummary: {
      isReadOnly: false,
      isNetworkTouching: false,
      isMemoryMutating: false,
      isApprovalSensitive: true,
      approvalHint: "must_require",
      riskLabel: "high"
    }
  }
];

// ── Default tool sets (static for CLI display) ─────────────────────────────────

interface ToolSetSummary {
  setId: string;
  name: string;
  description: string;
  riskLevel: string;
  toolIds: string[];
  containsApprovalSensitiveTools: boolean;
  requiresOperatorConfig: boolean;
}

const TOOL_SETS: ToolSetSummary[] = [
  {
    setId: "manasvi.toolset.starter-safe",
    name: "Starter Safe Set",
    description: "Read-only + search. Safe starting point for informational agents. No writes, no approval gates.",
    riskLevel: "low",
    toolIds: ["tool.local-file-read", "tool.http-fetch", "tool.web-search"],
    containsApprovalSensitiveTools: false,
    requiresOperatorConfig: true
  },
  {
    setId: "manasvi.toolset.notes",
    name: "Notes Set",
    description: "Adds governed memory note writing. Agents can persist facts, summaries, and session notes.",
    riskLevel: "medium",
    toolIds: ["tool.memory-note-write"],
    containsApprovalSensitiveTools: false,
    requiresOperatorConfig: true
  },
  {
    setId: "manasvi.toolset.governed-action",
    name: "Governed Action Set",
    description: "Approval request tool. Enables agents to route actions to human reviewers.",
    riskLevel: "low",
    toolIds: ["tool.approval-request"],
    containsApprovalSensitiveTools: true,
    requiresOperatorConfig: true
  },
  {
    setId: "manasvi.toolset.all-builtin",
    name: "All Built-in Tools",
    description: "Every built-in tool including shell command. High risk. Not for untrusted workloads.",
    riskLevel: "high",
    toolIds: [
      "tool.local-file-read", "tool.http-fetch", "tool.web-search",
      "tool.memory-note-write", "tool.approval-request", "tool.shell-command"
    ],
    containsApprovalSensitiveTools: true,
    requiresOperatorConfig: true
  }
];

// ── Fetch live tool data ───────────────────────────────────────────────────────

async function fetchLiveTools(orchestratorPort: number): Promise<ToolEntry[] | null> {
  try {
    const res = await fetch(`http://localhost:${orchestratorPort}/admin/tools`, {
      signal: AbortSignal.timeout(5000)
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { tools?: ToolEntry[] };
    return data.tools && data.tools.length > 0 ? data.tools : null;
  } catch {
    return null;
  }
}

// ── Formatting helpers ─────────────────────────────────────────────────────────

function riskBadge(risk: RiskSummary): string {
  if (risk.riskLabel === "high") return style.red("● high");
  if (risk.riskLabel === "medium") return style.yellow("● medium");
  return style.green("● low");
}

function statusBadge(status: string): string {
  if (status === "enabled") return style.green("enabled");
  if (status === "disabled") return style.yellow("disabled");
  return style.gray(status);
}

function approvalBadge(hint: "none" | "may_require" | "must_require"): string {
  if (hint === "must_require") return style.red("must require");
  if (hint === "may_require") return style.yellow("may require");
  return style.green("not required");
}

function boolBadge(value: boolean, trueLabel: string, falseLabel: string): string {
  return value ? style.yellow(trueLabel) : style.green(falseLabel);
}

// ── Command: tools list ────────────────────────────────────────────────────────

export async function runToolsList(args?: string[]): Promise<void> {
  banner("tools");

  const config = await loadConfig();
  if (!config?.initialized) {
    warn("Run `pnpm manasvi init` first");
    return;
  }

  const filterStatus = args?.includes("--enabled")
    ? "enabled"
    : args?.includes("--disabled")
      ? "disabled"
      : undefined;

  const orchestratorRunning = await isPortInUse(config.services.orchestratorPort);
  let tools: ToolEntry[];
  let dataSource: string;

  if (orchestratorRunning) {
    const live = await fetchLiveTools(config.services.orchestratorPort);
    if (live) {
      tools = live;
      dataSource = "live (orchestrator)";
    } else {
      tools = STATIC_TOOLS;
      dataSource = "static manifest (live fetch failed)";
    }
  } else {
    tools = STATIC_TOOLS;
    dataSource = "static manifest (orchestrator not running)";
  }

  if (filterStatus) {
    tools = tools.filter((t) => t.status === filterStatus);
  }

  section("Built-in tools");
  console.log(`  ${style.gray(`source: ${dataSource}`)}\n`);

  const COL_ID = 30;
  const COL_STATUS = 10;
  const COL_RISK = 10;
  const COL_APPROVAL = 14;

  // Header
  console.log(
    "  " +
    style.bold("Tool ID".padEnd(COL_ID)) +
    style.bold("Status".padEnd(COL_STATUS)) +
    style.bold("Risk".padEnd(COL_RISK)) +
    style.bold("Approval hint".padEnd(COL_APPROVAL)) +
    style.bold("Action class")
  );
  console.log("  " + style.gray("─".repeat(80)));

  for (const tool of tools) {
    const id = style.cyan(tool.toolId.padEnd(COL_ID));
    const status = statusBadge(tool.status).padEnd(COL_STATUS + 10); // pad accounts for ANSI codes
    const risk = riskBadge(tool.riskSummary);
    const approvalCol = approvalBadge(tool.riskSummary.approvalHint);
    const actionClass = style.gray(tool.actionClass);
    console.log(`  ${id}${status} ${risk.padEnd(20)} ${approvalCol.padEnd(20)} ${actionClass}`);
    console.log(`  ${" ".repeat(COL_ID)}${style.dim(tool.description.slice(0, 72))}`);
    console.log();
  }

  console.log();
  hint("Inspect a tool:         pnpm manasvi tools inspect <tool-id>");
  hint("View default tool sets: pnpm manasvi tools sets");
  hint("Policy config:          configs/policies/default-policy-set.json");
  hint("Tool docs:              docs-public/tools/overview.md");
  console.log();
}

// ── Command: tools inspect ─────────────────────────────────────────────────────

export async function runToolsInspect(toolId?: string, args?: string[]): Promise<void> {
  banner("tools inspect");

  if (!toolId) {
    warn("Specify a tool ID, e.g.:  pnpm manasvi tools inspect tool.web-search");
    hint("List tools: pnpm manasvi tools list");
    return;
  }

  const config = await loadConfig();
  let tool: ToolEntry | undefined;

  if (config?.initialized) {
    const orchestratorRunning = await isPortInUse(config.services.orchestratorPort);
    if (orchestratorRunning) {
      const live = await fetchLiveTools(config.services.orchestratorPort);
      tool = live?.find((t) => t.toolId === toolId);
    }
  }

  if (!tool) {
    tool = STATIC_TOOLS.find((t) => t.toolId === toolId);
  }

  if (!tool) {
    warn(`Tool not found: ${toolId}`);
    hint("List tools: pnpm manasvi tools list");
    return;
  }

  section(tool.name);

  // Identity
  table([
    { label: "Tool ID", value: tool.toolId },
    { label: "Version", value: tool.version },
    { label: "Type", value: tool.type },
    { label: "Status", value: tool.status, status: tool.status === "enabled" ? "ok" : "warn" },
    { label: "Owner", value: tool.owner ?? "manasvi-platform" },
    { label: "Provider", value: tool.provider ?? "manasvi-core" }
  ]);

  console.log();
  console.log(`  ${style.bold("Description")}`);
  console.log(`  ${style.dim(tool.description)}`);

  // Risk and governance
  console.log();
  section("Risk and governance");
  const r = tool.riskSummary;
  table([
    { label: "Risk level", value: r.riskLabel, status: r.riskLabel === "high" ? "error" : r.riskLabel === "medium" ? "warn" : "ok" },
    { label: "Action class", value: tool.actionClass },
    { label: "Side effect class", value: tool.sideEffectClass },
    { label: "Mutability", value: tool.mutability, status: tool.mutability === "mutating" ? "warn" : "ok" },
    { label: "Read-only", value: r.isReadOnly ? "yes" : "no", status: r.isReadOnly ? "ok" : "warn" },
    { label: "Network-touching", value: r.isNetworkTouching ? "yes" : "no", status: r.isNetworkTouching ? "warn" : "ok" },
    { label: "Memory-mutating", value: r.isMemoryMutating ? "yes" : "no", status: r.isMemoryMutating ? "warn" : "ok" },
    { label: "Approval-sensitive", value: r.isApprovalSensitive ? "YES" : "no", status: r.isApprovalSensitive ? "error" : "ok" },
    { label: "Approval hint", value: r.approvalHint, status: r.approvalHint === "must_require" ? "error" : r.approvalHint === "may_require" ? "warn" : "ok" }
  ]);

  // Policy binding
  console.log();
  section("Policy binding");
  table([
    { label: "Policy action class", value: tool.policyBinding.policyActionClass },
    { label: "Resource class", value: tool.policyBinding.resource.resourceClass },
    { label: "Resource ID", value: tool.policyBinding.resource.resourceId },
    { label: "Requires explicit policy", value: tool.policyBinding.requiresExplicitPolicy ? "yes" : "no", status: tool.policyBinding.requiresExplicitPolicy ? "warn" : "ok" }
  ]);

  // Runtime profile
  console.log();
  section("Runtime sandbox profile");
  const rh = tool.runtimeHints;
  table([
    { label: "Sandbox mode", value: rh.defaultSandboxMode },
    { label: "Filesystem profile", value: rh.filesystemProfile },
    { label: "Default timeout", value: `${rh.defaultTimeoutMs}ms` },
    { label: "Egress profiles", value: rh.egressProfiles.length > 0 ? rh.egressProfiles.join(", ") : "none" },
    { label: "Secret refs declared", value: rh.declaredSecretRefs.length > 0 ? rh.declaredSecretRefs.join(", ") : "none" },
    { label: "Requires executor path", value: rh.requireExecutorPath ? "yes" : "no" }
  ]);

  // Capabilities and resources
  console.log();
  section("Capabilities and resource scope");
  console.log(`  ${style.bold("Capabilities required:")}`);
  for (const cap of tool.capabilities) {
    console.log(`    ${sym.bullet} ${style.cyan(cap)}`);
  }
  console.log(`  ${style.bold("Resource classes touched:")}`);
  for (const rc of tool.resourceClassesTouched) {
    console.log(`    ${sym.bullet} ${style.yellow(rc)}`);
  }

  // Trust notes
  if (tool.trustNotes && tool.trustNotes.length > 0) {
    console.log();
    section("Trust and security notes");
    for (const note of tool.trustNotes) {
      console.log(`  ${sym.info} ${note}`);
    }
  }

  // Tags
  if (tool.tags && tool.tags.length > 0) {
    console.log();
    console.log(`  ${style.bold("Tags:")} ${tool.tags.map((t) => style.gray(`#${t}`)).join("  ")}`);
  }

  // Denied tool use guidance
  console.log();
  section("If this tool is denied");
  console.log(`  ${sym.arrow} Tool disabled:   Set status to "enabled" via POST /tools/status on the orchestrator.`);
  console.log(`  ${sym.arrow} Policy denied:   Add an allow rule for action "${tool.policyBinding.policyActionClass}" in configs/policies/`);
  console.log(`  ${sym.arrow} Approval needed: Submit approval via POST /orchestration/execution-intents/approval-decision`);
  console.log(`  ${sym.arrow} Config missing:  Check egress allowlist, filesystem read paths, and secret refs in config.`);

  console.log();
  hint(`Docs: docs-public/tools/${tool.toolId.replace("tool.", "")}.md`);
  hint("Policy config: configs/policies/default-policy-set.json");
  console.log();
}

// ── Command: tools sets ────────────────────────────────────────────────────────

export async function runToolsSets(): Promise<void> {
  banner("tool sets");

  section("Available default tool sets");
  console.log(
    `  ${"Tool sets are curated groups of tools with a defined risk posture."}\n` +
    `  ${"Enabling a set requires matching policy rules. Sets are a starting point, not a grant."}\n`
  );

  for (const set of TOOL_SETS) {
    const riskColor =
      set.riskLevel === "high" ? style.red : set.riskLevel === "medium" ? style.yellow : style.green;

    console.log(`  ${style.bold(style.cyan(set.name))} ${style.gray(`(${set.setId})`)}`);
    console.log(`  ${style.dim(set.description)}`);
    console.log(
      `  Risk: ${riskColor(set.riskLevel)}` +
      (set.containsApprovalSensitiveTools ? `  ${style.yellow("contains approval-sensitive tools")}` : "") +
      (set.requiresOperatorConfig ? `  ${style.gray("requires operator config")}` : "")
    );
    console.log(`  Tools: ${set.toolIds.map((id) => style.cyan(id)).join(", ")}`);
    console.log();
  }

  hint("Docs: docs-public/tools/default-sets.md");
  hint("Policy config: configs/policies/default-policy-set.json");
  console.log();
}
