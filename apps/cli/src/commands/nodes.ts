/**
 * manasvi nodes <list|status|pair>
 * Remote execution node management.
 */

import { banner, section, info, success, warn, hint, table, style } from "../lib/ui.js";
import { loadConfig } from "../lib/config.js";
import { isPortInUse } from "../lib/health.js";

interface NodeRecord {
  nodeId: string;
  nodeClass: string;
  status: string;
  lastSeen?: string;
}

async function fetchNodes(nodeManagerPort: number): Promise<NodeRecord[]> {
  try {
    const res = await fetch(`http://localhost:${nodeManagerPort}/nodes`, {
      signal: AbortSignal.timeout(3000)
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { nodes?: NodeRecord[] };
    return data.nodes ?? [];
  } catch {
    return [];
  }
}

export async function runNodesList(): Promise<void> {
  banner("nodes");

  const config = await loadConfig();
  if (!config?.initialized) { warn("Run `pnpm manasvi init` first"); return; }

  const managerRunning = await isPortInUse(config.services.nodeManagerPort);

  if (!managerRunning) {
    warn("Node manager is not running");
    hint("Start services: pnpm manasvi start");
    return;
  }

  const nodes = await fetchNodes(config.services.nodeManagerPort);

  section("Registered nodes");

  if (nodes.length === 0) {
    console.log(`  ${style.dim("○")} No nodes registered`);
    console.log();
    info("Nodes are remote execution environments.");
    hint("Pair a node: pnpm manasvi nodes pair");
  } else {
    for (const node of nodes) {
      const statusIcon = node.status === "healthy" ? style.green("●") : style.dim("○");
      console.log(`  ${statusIcon} ${style.cyan(node.nodeId)}  ${style.dim(node.nodeClass)}`);
      if (node.lastSeen) {
        console.log(`     ${style.dim("last seen: " + node.lastSeen)}`);
      }
    }
  }

  console.log();
}

export async function runNodesStatus(): Promise<void> {
  banner("nodes status");

  const config = await loadConfig();
  if (!config?.initialized) { warn("Run `pnpm manasvi init` first"); return; }

  const managerRunning = await isPortInUse(config.services.nodeManagerPort);

  table([
    {
      label: "Node Manager",
      value: managerRunning ? `running on :${config.services.nodeManagerPort}` : "stopped",
      status: managerRunning ? "ok" : "warn"
    }
  ]);

  if (managerRunning) {
    const nodes = await fetchNodes(config.services.nodeManagerPort);
    info(`${nodes.length} node(s) registered`);
  }

  console.log();
}

export async function runNodesPair(): Promise<void> {
  banner("nodes pair");
  info("Node pairing allows remote execution environments to register with Manasvi.");
  console.log();
  hint("To pair a node:");
  console.log(`  ${style.dim("1.")} On the remote machine, install the node agent`);
  console.log(`  ${style.dim("2.")} Configure the node with the node manager URL`);
  console.log(`  ${style.dim("3.")} The node agent initiates a pairing request`);
  console.log(`  ${style.dim("4.")} The pairing grant is issued and the node can receive dispatch`);
  console.log();
  hint("Node manager API: http://localhost:" + (loadConfig()
    .then(c => c?.services.nodeManagerPort ?? 4106)
    .catch(() => 4106)));
  hint("See architecture docs: pnpm manasvi ui");
  console.log();
}
