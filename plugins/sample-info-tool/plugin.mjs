/**
 * Sample Info Tool Plugin — out-of-process Node.js plugin
 *
 * This plugin demonstrates:
 * - Connecting to the extension-runtime host via the plugin SDK RPC protocol
 * - Providing two read-only tools (echo, plugin-status) without inheriting core trust
 * - Low-risk capability profile that qualifies for auto-approval in dev mode
 *
 * Isolation: this process has no access to Manasvi internal service APIs.
 * Everything flows through the narrow plugin SDK → extension-runtime RPC interface.
 *
 * Run via: extension-runtime spawns this with PLUGIN_HOST_RPC_URL etc. in env.
 */

import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// ── Load manifest ─────────────────────────────────────────────────────────────

const __dir = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(join(__dir, "manifest.json"), "utf8"));

// ── State ─────────────────────────────────────────────────────────────────────

let grantedCapabilities = [];
let principalId = "";
let running = false;

// ── Tool handlers ─────────────────────────────────────────────────────────────

function handleEcho(input) {
  const message = typeof input.message === "string" ? input.message : "";
  return { echo: message };
}

function handlePluginStatus() {
  return {
    pluginId: manifest.pluginId,
    version: manifest.version,
    principalId,
    grantedCapabilityCount: grantedCapabilities.length,
    riskClass: manifest.riskClass
  };
}

const toolHandlers = new Map([
  ["manasvi.info.echo", handleEcho],
  ["manasvi.info.plugin-status", handlePluginStatus]
]);

// ── HTTP callback server ──────────────────────────────────────────────────────

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
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
        error: { code: "TOOL_NOT_FOUND", message: `Tool '${invocationReq.targetId}' not registered` },
        durationMs: Date.now() - start
      });
      return;
    }

    try {
      const output = await handler(invocationReq.payload ?? {});
      writeJson(res, 200, {
        rpcId: invocationReq.rpcId,
        ok: true,
        output,
        durationMs: Date.now() - start
      });
    } catch (error) {
      writeJson(res, 200, {
        rpcId: invocationReq.rpcId,
        ok: false,
        output: {},
        error: { code: "HANDLER_ERROR", message: error instanceof Error ? error.message : "unknown" },
        durationMs: Date.now() - start
      });
    }
    return;
  }

  writeJson(res, 404, { error: "NOT_FOUND" });
}

// ── Handshake with host ───────────────────────────────────────────────────────

async function computeManifestHash(manifest) {
  const { createHash } = await import("node:crypto");
  const sorted = JSON.stringify(manifest, Object.keys(manifest).sort());
  return createHash("sha256").update(sorted, "utf8").digest("hex");
}

async function performHandshake(hostRpcUrl, callbackUrl, launchToken) {
  const manifestHash = await computeManifestHash(manifest);
  const nonce = randomUUID().replace(/-/g, "");

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
    nonce
  };

  const response = await fetch(`${hostRpcUrl}/internal/plugin-rpc/handshake`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-plugin-id": manifest.pluginId
    },
    body: JSON.stringify(request)
  });

  if (!response.ok) {
    throw new Error(`Handshake HTTP error: ${response.status}`);
  }

  return response.json();
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const hostRpcUrl = process.env["PLUGIN_HOST_RPC_URL"];
  const callbackPort = parseInt(process.env["PLUGIN_CALLBACK_PORT"] ?? "0", 10);
  const launchToken = process.env["PLUGIN_LAUNCH_TOKEN"] ?? "";

  if (!hostRpcUrl) {
    console.error(JSON.stringify({
      level: "error",
      msg: "PLUGIN_HOST_RPC_URL not set. Plugin must be launched by extension-runtime."
    }));
    process.exit(1);
  }

  const port = callbackPort > 0 ? callbackPort : 0;
  const server = createServer((req, res) => {
    handleRequest(req, res).catch((err) => {
      console.error(JSON.stringify({ level: "error", msg: String(err) }));
      res.writeHead(500);
      res.end();
    });
  });

  await new Promise((resolve, reject) => {
    server.listen(port, "127.0.0.1", () => resolve());
    server.once("error", reject);
  });

  const actualPort = server.address().port;
  const callbackUrl = `http://127.0.0.1:${actualPort}`;

  console.log(JSON.stringify({
    level: "info",
    msg: "Plugin callback server listening",
    pluginId: manifest.pluginId,
    port: actualPort
  }));

  const handshakeResponse = await performHandshake(hostRpcUrl, callbackUrl, launchToken);

  if (!handshakeResponse.accepted) {
    console.error(JSON.stringify({
      level: "error",
      msg: "Handshake rejected",
      reason: handshakeResponse.rejectionReason ?? "unknown"
    }));
    server.close();
    process.exit(1);
  }

  grantedCapabilities = handshakeResponse.grantedCapabilities ?? [];
  principalId = handshakeResponse.pluginPrincipalId ?? `plugin:${manifest.pluginId}@${manifest.version}`;
  running = true;

  console.log(JSON.stringify({
    level: "info",
    msg: "Plugin handshake accepted",
    pluginId: manifest.pluginId,
    principalId,
    grantedCapabilityCount: grantedCapabilities.length
  }));

  process.once("SIGTERM", () => {
    console.log(JSON.stringify({ level: "info", msg: "Plugin shutting down", pluginId: manifest.pluginId }));
    running = false;
    server.close(() => process.exit(0));
  });

  process.once("SIGINT", () => {
    running = false;
    server.close(() => process.exit(0));
  });
}

main().catch((err) => {
  console.error(JSON.stringify({ level: "error", msg: String(err) }));
  process.exit(1);
});
