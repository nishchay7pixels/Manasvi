/**
 * manasvi nodes <list|status|pair>
 * Remote execution node management.
 */

import { banner, section, info, success, warn, hint, table, style, checkRow } from "../lib/ui.js";
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
    warn("Node manager is not running.");
    hint("Start services: pnpm manasvi start");
    hint("Check status:   pnpm manasvi nodes status");
    return;
  }

  const nodes = await fetchNodes(config.services.nodeManagerPort);

  section("Registered remote nodes");

  if (nodes.length === 0) {
    console.log(`  ${style.dim("○")} No nodes registered`);
    console.log();
    info("Nodes are remote execution environments connected to this Manasvi instance.");
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
  hint("Node details: pnpm manasvi nodes status");
}

export async function runNodesStatus(): Promise<void> {
  banner("nodes status");

  const config = await loadConfig();
  if (!config?.initialized) { warn("Run `pnpm manasvi init` first"); return; }

  const managerRunning = await isPortInUse(config.services.nodeManagerPort);

  section("Node Manager");
  checkRow("Node manager service", managerRunning ? "pass" : "warn",
    managerRunning ? `running on :${config.services.nodeManagerPort}` : "stopped");

  if (managerRunning) {
    const nodes = await fetchNodes(config.services.nodeManagerPort);

    if (nodes.length > 0) {
      section("Registered nodes");
      for (const node of nodes) {
        const st = node.status === "healthy" ? "pass" : "warn";
        checkRow(node.nodeId, st as "pass" | "warn", `${node.nodeClass}${node.lastSeen ? ` · last seen: ${node.lastSeen}` : ""}`);
      }
    } else {
      info("No nodes registered.");
    }
  } else {
    hint("Start services: pnpm manasvi start");
  }

  console.log();
  hint("Pair a new node: pnpm manasvi nodes pair");
  console.log();
}

export async function runNodesPair(): Promise<void> {
  banner("nodes pair");

  const config = await loadConfig();
  const nodeManagerPort = config?.services.nodeManagerPort ?? 4106;
  const nodeManagerUrl = `http://localhost:${nodeManagerPort}`;

  info("Node pairing allows remote execution environments to register with Manasvi.");
  console.log();

  section("Current state");
  warn("Node pairing is not yet transactional from the CLI.");
  info("The node manager service handles pairing — the CLI cannot yet initiate it directly.");
  console.log();

  section("Manual pairing steps");
  console.log(`  ${style.dim("1.")} Ensure the node manager is running:`);
  console.log(`     ${style.dim("$")} ${style.cyan("pnpm manasvi start")}`);
  console.log(`     ${style.dim("$")} ${style.cyan("pnpm manasvi nodes status")}`);
  console.log();
  console.log(`  ${style.dim("2.")} On the remote machine, install the Manasvi node agent`);
  console.log(`  ${style.dim("3.")} Configure the node agent with this node manager URL:`);
  console.log(`     ${style.cyan(nodeManagerUrl)}`);
  console.log(`  ${style.dim("4.")} Start the node agent — it initiates the pairing request`);
  console.log(`  ${style.dim("5.")} Verify: pnpm manasvi nodes list`);
  console.log();

  section("Planned CLI flow");
  console.log(`  ${style.dim("$")} ${style.cyan("pnpm manasvi nodes pair --name my-laptop")}   ${style.dim("# generates pairing token")}`);
  console.log(`  ${style.dim("$")} ${style.cyan("pnpm manasvi nodes list")}                   ${style.dim("# verify registration")}`);
  console.log();

  info("Node pairing CLI will be transactional when the node manager exposes a pairing initiation API.");
  hint("See architecture docs: pnpm manasvi ui");
  console.log();
}
