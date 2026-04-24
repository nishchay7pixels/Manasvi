/**
 * Capability Denial Demo Plugin — out-of-process Node.js plugin
 *
 * This plugin demonstrates:
 * - A high-risk plugin that requests sensitive capabilities (network access, secret access)
 * - How the extension-runtime capability approver handles partial denial
 * - That the plugin receives ONLY the granted capabilities, not all requested ones
 * - That denied capabilities are clearly recorded and observable
 *
 * In default configuration (requireExplicitCapabilityApproval=true), this plugin
 * will land in `pending_approval` state after registration and require an operator
 * to POST /plugins/:id/approve before it can be started.
 *
 * The provided tool `high-risk-info` reports back which capabilities were granted
 * vs denied — proving the plugin cannot self-grant what was denied.
 */

import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(join(__dir, "manifest.json"), "utf8"));

let grantedCapabilities = [];
let principalId = "";
let running = false;

// ── Tool handlers ─────────────────────────────────────────────────────────────

function handleHighRiskInfo() {
  const grantedIds = grantedCapabilities.map((g) => g.capabilityId);
  const allRequestedIds = manifest.requestedCapabilities.map((c) => c.capabilityId);
  const deniedIds = allRequestedIds.filter((id) => !grantedIds.includes(id));

  return {
    pluginId: manifest.pluginId,
    riskClass: manifest.riskClass,
    granted: grantedIds,
    denied: deniedIds,
    note: "This plugin cannot access capabilities that were not explicitly granted by the operator."
  };
}

const toolHandlers = new Map([
  ["manasvi.demo.high-risk-info", handleHighRiskInfo]
]);

// ── HTTP helpers ──────────────────────────────────────────────────────────────

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

function writeJson(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

async function handleRequest(req, res) {
  if (req.method === "GET" && req.url === "/health") {
    writeJson(res, 200, { ok: true, running });
    return;
  }

  if (req.method === "POST" && req.url === "/invoke") {
    const bodyText = await readBody(req);
    const invocationReq = JSON.parse(bodyText);
    const start = Date.now();

    const handler = toolHandlers.get(invocationReq.targetId);
    if (!handler) {
      writeJson(res, 200, {
        rpcId: invocationReq.rpcId,
        ok: false,
        output: {},
        error: { code: "TOOL_NOT_FOUND", message: `Unknown tool: ${invocationReq.targetId}` },
        durationMs: Date.now() - start
      });
      return;
    }

    const output = handler(invocationReq.payload ?? {});
    writeJson(res, 200, {
      rpcId: invocationReq.rpcId,
      ok: true,
      output,
      durationMs: Date.now() - start
    });
    return;
  }

  writeJson(res, 404, { error: "NOT_FOUND" });
}

// ── Handshake ─────────────────────────────────────────────────────────────────

async function computeManifestHash(manifest) {
  const { createHash } = await import("node:crypto");
  const sorted = JSON.stringify(manifest, Object.keys(manifest).sort());
  return createHash("sha256").update(sorted, "utf8").digest("hex");
}

async function performHandshake(hostRpcUrl, callbackUrl, launchToken) {
  const manifestHash = await computeManifestHash(manifest);
  const request = {
    protocolVersion: "1.0",
    pluginId: manifest.pluginId,
    pluginVersion: manifest.version,
    manifestHash,
    requestedCapabilities: manifest.requestedCapabilities,
    providedTools: manifest.providedTools,
    supportedApiVersion: manifest.supportedApiVersion,
    callbackUrl,
    provenanceToken: launchToken,
    timestamp: new Date().toISOString(),
    nonce: randomUUID().replace(/-/g, "")
  };

  const response = await fetch(`${hostRpcUrl}/internal/plugin-rpc/handshake`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-plugin-id": manifest.pluginId },
    body: JSON.stringify(request)
  });

  if (!response.ok) throw new Error(`Handshake failed: HTTP ${response.status}`);
  return response.json();
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const hostRpcUrl = process.env["PLUGIN_HOST_RPC_URL"];
  const callbackPort = parseInt(process.env["PLUGIN_CALLBACK_PORT"] ?? "0", 10);
  const launchToken = process.env["PLUGIN_LAUNCH_TOKEN"] ?? "";

  if (!hostRpcUrl) {
    console.error(JSON.stringify({ level: "error", msg: "PLUGIN_HOST_RPC_URL not set" }));
    process.exit(1);
  }

  const server = createServer((req, res) => {
    handleRequest(req, res).catch((err) => {
      res.writeHead(500);
      res.end();
    });
  });

  await new Promise((resolve, reject) => {
    server.listen(callbackPort > 0 ? callbackPort : 0, "127.0.0.1", () => resolve());
    server.once("error", reject);
  });

  const actualPort = server.address().port;
  const callbackUrl = `http://127.0.0.1:${actualPort}`;

  console.log(JSON.stringify({ level: "info", msg: "Callback server ready", port: actualPort }));

  const handshakeResponse = await performHandshake(hostRpcUrl, callbackUrl, launchToken);

  if (!handshakeResponse.accepted) {
    console.error(JSON.stringify({
      level: "error",
      msg: "Handshake rejected — plugin cannot run",
      reason: handshakeResponse.rejectionReason
    }));
    server.close();
    process.exit(1);
  }

  grantedCapabilities = handshakeResponse.grantedCapabilities ?? [];
  principalId = handshakeResponse.pluginPrincipalId ?? "";
  running = true;

  // Log which capabilities were granted vs denied — demonstrates the system works
  const grantedIds = grantedCapabilities.map((g) => g.capabilityId);
  const allRequestedIds = manifest.requestedCapabilities.map((c) => c.capabilityId);
  const deniedIds = allRequestedIds.filter((id) => !grantedIds.includes(id));

  console.log(JSON.stringify({
    level: "info",
    msg: "Plugin running with capability subset",
    pluginId: manifest.pluginId,
    granted: grantedIds,
    denied: deniedIds
  }));

  process.once("SIGTERM", () => {
    running = false;
    server.close(() => process.exit(0));
  });
}

main().catch((err) => {
  console.error(JSON.stringify({ level: "error", msg: String(err) }));
  process.exit(1);
});
