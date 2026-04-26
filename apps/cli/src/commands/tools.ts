/**
 * manasvi tools <list|inspect|enable|disable>
 * Reads tool registry from the orchestrator service.
 */

import { banner, section, info, success, warn, hint, table, style } from "../lib/ui.js";
import { loadConfig } from "../lib/config.js";
import { isPortInUse } from "../lib/health.js";

interface ToolEntry {
  toolId: string;
  name: string;
  version: string;
  status: string;
  actionClass?: string;
  description?: string;
}

async function fetchTools(orchestratorPort: number): Promise<ToolEntry[]> {
  try {
    const res = await fetch(`http://localhost:${orchestratorPort}/tools/status`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
      signal: AbortSignal.timeout(5000)
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { tools?: ToolEntry[] };
    return data.tools ?? [];
  } catch {
    return [];
  }
}

// Built-in tool definitions (fallback when orchestrator is not running)
const BUILTIN_TOOLS = [
  { toolId: "tool.web-search", name: "Web Search", status: "enabled", actionClass: "access-network", description: "Policy-governed web search" },
  { toolId: "tool.http-fetch", name: "HTTP Fetch", status: "enabled", actionClass: "access-network", description: "Fetch remote content under egress policy" },
  { toolId: "tool.local-file-read", name: "Local File Read", status: "enabled", actionClass: "access-filesystem", description: "Reads a local file through sandboxed paths" },
  { toolId: "tool.shell-command", name: "Shell Command", status: "enabled", actionClass: "execute-shell", description: "Bounded shell execution under sandbox controls" },
  { toolId: "tool.memory-note-write", name: "Memory Note Write", status: "enabled", actionClass: "write-memory", description: "Writes a note into memory namespace" },
  { toolId: "tool.approval-request", name: "Approval Request", status: "enabled", actionClass: "workflow-control", description: "Creates a human approval request" }
];

export async function runToolsList(): Promise<void> {
  banner("tools");

  const config = await loadConfig();
  if (!config?.initialized) { warn("Run `pnpm manasvi init` first"); return; }

  const orchestratorRunning = await isPortInUse(config.services.orchestratorPort);

  let tools: ToolEntry[];
  if (orchestratorRunning) {
    tools = await fetchTools(config.services.orchestratorPort);
    if (tools.length === 0) tools = BUILTIN_TOOLS;
  } else {
    tools = BUILTIN_TOOLS;
    info("Orchestrator not running — showing static tool manifest");
  }

  section("Available tools");

  for (const tool of tools) {
    const statusIcon = tool.status === "enabled" ? style.green("●") : style.dim("○");
    const id = style.cyan(tool.toolId);
    const cls = tool.actionClass ? style.dim(` [${tool.actionClass}]`) : "";
    console.log(`  ${statusIcon} ${id}${cls}`);
    if (tool.description) {
      console.log(`     ${style.dim(tool.description)}`);
    }
  }

  console.log();
  hint("Inspect a tool: pnpm manasvi tools inspect <tool-id>");
  hint("Tool policy is governed by the policy service — see configs/policies/");
  console.log();
}

export async function runToolsInspect(toolId?: string): Promise<void> {
  banner("tools inspect");

  if (!toolId) {
    warn("Specify a tool ID, e.g.: pnpm manasvi tools inspect tool.web-search");
    return;
  }

  const tool = BUILTIN_TOOLS.find((t) => t.toolId === toolId);
  if (!tool) {
    warn(`Tool not found: ${toolId}`);
    hint("List tools: pnpm manasvi tools list");
    return;
  }

  section(tool.name);
  table([
    { label: "Tool ID", value: tool.toolId },
    { label: "Status", value: tool.status, status: tool.status === "enabled" ? "ok" : "warn" },
    { label: "Action class", value: tool.actionClass ?? "—" },
    { label: "Description", value: tool.description ?? "—" }
  ]);

  console.log();
  hint("Policy rules for this tool: configs/policies/default-policy-set.json");
  console.log();
}
