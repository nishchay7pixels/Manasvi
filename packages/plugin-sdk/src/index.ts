/**
 * @manasvi/plugin-sdk
 *
 * Developer-facing SDK for building out-of-process Manasvi plugins.
 *
 * A plugin using this SDK:
 * 1. Defines a manifest declaring identity, capabilities, and provided tools.
 * 2. Creates a `PluginRunner` with tool/hook handlers.
 * 3. Calls `runner.start()` — the SDK starts a local HTTP server, connects to the
 *    extension-runtime host, performs the handshake, and waits for invocations.
 *
 * The SDK never inherits core trust. Everything flows through the handshake and
 * the granted capability set returned by the host.
 *
 * Environment variables injected by the host at process launch:
 *   PLUGIN_HOST_RPC_URL   — extension-runtime RPC base URL
 *   PLUGIN_ID             — plugin ID from manifest
 *   PLUGIN_LAUNCH_TOKEN   — one-time token for identity verification
 *   PLUGIN_CALLBACK_PORT  — local port this plugin should listen on
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";

import type {
  PluginManifest,
  PluginCapabilityGrant,
  PluginToolDeclaration,
  PluginHookDeclaration,
  PluginHandshakeRequest,
  PluginHandshakeResponse,
  PluginInvocationRequest,
  PluginInvocationResponse
} from "@manasvi/contracts";

import {
  computeManifestHash,
  buildPluginPrincipalId,
  parsePluginManifest
} from "@manasvi/contracts";

// ─── Re-export contract types for plugin authors ──────────────────────────────

export type {
  PluginManifest,
  PluginCapabilityGrant,
  PluginCapabilityRequest,
  PluginToolDeclaration,
  PluginHookDeclaration,
  PluginCapabilityFamily,
  PluginRiskClass,
  PluginRuntimeType,
  PluginProvenance,
  PluginResourceProfile,
  PluginLifecycleState,
  PluginRegistryEntry,
  PluginHandshakeRequest,
  PluginHandshakeResponse,
  PluginInvocationRequest,
  PluginInvocationResponse
} from "@manasvi/contracts";

export {
  computeManifestHash,
  buildPluginPrincipalId,
  parsePluginManifest,
  createCapabilityGrant,
  createPluginLifecycleEvent,
  pluginManifestSchema,
  pluginCapabilityGrantSchema,
  PLUGIN_CONTRACT_VERSION,
  PLUGIN_PROTOCOL_VERSION,
  PLUGIN_API_VERSION
} from "@manasvi/contracts";

// ─── Tool handler types ───────────────────────────────────────────────────────

export interface ToolInvocationContext {
  traceId: string;
  correlationId: string;
  grantedCapabilities: PluginCapabilityGrant[];
  pluginPrincipalId: string;
}

export type ToolHandler = (
  input: Record<string, unknown>,
  ctx: ToolInvocationContext
) => Promise<Record<string, unknown>>;

export type HookHandler = (
  payload: Record<string, unknown>,
  ctx: ToolInvocationContext
) => Promise<void>;

// ─── Plugin runner options ────────────────────────────────────────────────────

export interface PluginRunnerOptions {
  manifest: PluginManifest;
  tools?: Map<string, ToolHandler>;
  hooks?: Map<string, HookHandler>;
  /**
   * Called once after handshake succeeds with the granted capability set.
   * Lets plugins adjust behaviour based on what was actually approved.
   */
  onReady?: (ctx: {
    grantedCapabilities: PluginCapabilityGrant[];
    principalId: string;
  }) => void | Promise<void>;
  /**
   * Called when the host revokes or stops this plugin.
   */
  onStop?: () => void | Promise<void>;
  logger?: {
    info: (msg: string, meta?: Record<string, unknown>) => void;
    warn: (msg: string, meta?: Record<string, unknown>) => void;
    error: (msg: string, meta?: Record<string, unknown>) => void;
  };
}

// ─── Plugin runner ────────────────────────────────────────────────────────────

/**
 * Manages the plugin's connection to the extension-runtime host.
 *
 * Isolation note: this runner intentionally does NOT have access to any
 * internal Manasvi service APIs. All communication flows through the narrow
 * HTTP RPC interface defined by the extension plane.
 */
export class PluginRunner {
  private readonly manifest: PluginManifest;
  private readonly tools: Map<string, ToolHandler>;
  private readonly hooks: Map<string, HookHandler>;
  private readonly onReady?: PluginRunnerOptions["onReady"];
  private readonly onStop?: PluginRunnerOptions["onStop"];
  private readonly log: NonNullable<PluginRunnerOptions["logger"]>;

  private grantedCapabilities: PluginCapabilityGrant[] = [];
  private principalId = "";
  private sessionToken = "";
  private server: ReturnType<typeof createServer> | null = null;
  private running = false;

  constructor(options: PluginRunnerOptions) {
    this.manifest = options.manifest;
    this.tools = options.tools ?? new Map();
    this.hooks = options.hooks ?? new Map();
    this.onReady = options.onReady;
    this.onStop = options.onStop;
    this.log = options.logger ?? {
      info: (msg, meta) => console.log(JSON.stringify({ level: "info", msg, ...meta })),
      warn: (msg, meta) => console.warn(JSON.stringify({ level: "warn", msg, ...meta })),
      error: (msg, meta) => console.error(JSON.stringify({ level: "error", msg, ...meta }))
    };
  }

  /** Start the plugin: open callback HTTP server, perform handshake with host. */
  async start(): Promise<void> {
    const hostRpcUrl = process.env["PLUGIN_HOST_RPC_URL"];
    const callbackPort = parseInt(process.env["PLUGIN_CALLBACK_PORT"] ?? "0", 10);
    const launchToken = process.env["PLUGIN_LAUNCH_TOKEN"] ?? "";

    if (!hostRpcUrl) {
      throw new Error(
        "PLUGIN_HOST_RPC_URL is not set. Plugin must be launched by extension-runtime."
      );
    }

    const port = callbackPort > 0 ? callbackPort : await pickFreePort();
    const callbackUrl = `http://127.0.0.1:${port}`;

    await this.startCallbackServer(port);

    const handshakeResponse = await this.performHandshake(hostRpcUrl, callbackUrl, launchToken);

    if (!handshakeResponse.accepted) {
      this.log.error("Handshake rejected by host", {
        reason: handshakeResponse.rejectionReason ?? "unknown"
      });
      await this.shutdown();
      process.exit(1);
    }

    this.grantedCapabilities = handshakeResponse.grantedCapabilities;
    this.principalId = handshakeResponse.pluginPrincipalId ?? buildPluginPrincipalId(this.manifest.pluginId, this.manifest.version);
    this.sessionToken = handshakeResponse.sessionToken ?? "";
    this.running = true;

    this.log.info("Plugin handshake accepted", {
      pluginId: this.manifest.pluginId,
      principalId: this.principalId,
      grantedCapabilityCount: this.grantedCapabilities.length
    });

    if (this.onReady) {
      await this.onReady({
        grantedCapabilities: this.grantedCapabilities,
        principalId: this.principalId
      });
    }

    process.once("SIGTERM", () => void this.shutdown());
    process.once("SIGINT", () => void this.shutdown());
  }

  async shutdown(): Promise<void> {
    this.running = false;
    if (this.onStop) {
      try {
        await this.onStop();
      } catch {
        // ignore shutdown errors
      }
    }
    await this.stopCallbackServer();
  }

  // ── Private: HTTP callback server (receives invocations from host) ──────────

  private async startCallbackServer(port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = createServer((req, res) => {
        void this.handleIncomingRequest(req, res);
      });
      this.server.listen(port, "127.0.0.1", () => {
        this.log.info("Plugin callback server listening", { port });
        resolve();
      });
      this.server.once("error", reject);
    });
  }

  private async stopCallbackServer(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => resolve());
      } else {
        resolve();
      }
    });
  }

  private async handleIncomingRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      if (req.method === "GET" && req.url === "/health") {
        writeJson(res, 200, { ok: true, running: this.running });
        return;
      }

      if (req.method === "POST" && req.url === "/invoke") {
        const body = await readBody(req);
        const invocationReq = JSON.parse(body) as PluginInvocationRequest;
        const result = await this.handleInvocation(invocationReq);
        writeJson(res, 200, result);
        return;
      }

      writeJson(res, 404, { error: "NOT_FOUND" });
    } catch (error) {
      this.log.error("Callback server error", {
        error: error instanceof Error ? error.message : "unknown"
      });
      writeJson(res, 500, { error: "INTERNAL_ERROR" });
    }
  }

  private async handleInvocation(
    req: PluginInvocationRequest
  ): Promise<PluginInvocationResponse> {
    const start = Date.now();
    const ctx: ToolInvocationContext = {
      traceId: req.trace.traceId,
      correlationId: req.trace.correlationId,
      grantedCapabilities: this.grantedCapabilities,
      pluginPrincipalId: this.principalId
    };

    try {
      if (req.method === "tool.invoke") {
        const handler = this.tools.get(req.targetId);
        if (!handler) {
          return {
            rpcId: req.rpcId,
            ok: false,
            output: {},
            error: { code: "TOOL_NOT_FOUND", message: `Tool '${req.targetId}' not registered` },
            durationMs: Date.now() - start
          };
        }
        const output = await handler(req.payload, ctx);
        return { rpcId: req.rpcId, ok: true, output, durationMs: Date.now() - start };
      }

      if (req.method === "hook.trigger") {
        const handler = this.hooks.get(req.targetId);
        if (!handler) {
          return {
            rpcId: req.rpcId,
            ok: false,
            output: {},
            error: { code: "HOOK_NOT_FOUND", message: `Hook '${req.targetId}' not registered` },
            durationMs: Date.now() - start
          };
        }
        await handler(req.payload, ctx);
        return { rpcId: req.rpcId, ok: true, output: {}, durationMs: Date.now() - start };
      }

      return {
        rpcId: req.rpcId,
        ok: false,
        output: {},
        error: { code: "UNSUPPORTED_METHOD", message: `Unsupported RPC method: ${req.method}` },
        durationMs: Date.now() - start
      };
    } catch (error) {
      return {
        rpcId: req.rpcId,
        ok: false,
        output: {},
        error: {
          code: "HANDLER_ERROR",
          message: error instanceof Error ? error.message : "Unknown handler error"
        },
        durationMs: Date.now() - start
      };
    }
  }

  // ── Private: handshake with host ────────────────────────────────────────────

  private async performHandshake(
    hostRpcUrl: string,
    callbackUrl: string,
    launchToken: string
  ): Promise<PluginHandshakeResponse> {
    const manifestHash = computeManifestHash(this.manifest);
    const nonce = randomUUID().replace(/-/g, "");

    const request: PluginHandshakeRequest = {
      protocolVersion: "1.0",
      pluginId: this.manifest.pluginId,
      pluginVersion: this.manifest.version,
      manifestHash,
      requestedCapabilities: this.manifest.requestedCapabilities,
      providedTools: this.manifest.providedTools,
      supportedApiVersion: this.manifest.supportedApiVersion,
      callbackUrl,
      ...(launchToken ? { provenanceToken: launchToken } : {}),
      timestamp: new Date().toISOString(),
      nonce
    };

    const response = await fetch(`${hostRpcUrl}/internal/plugin-rpc/handshake`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-plugin-id": this.manifest.pluginId
      },
      body: JSON.stringify(request)
    });

    if (!response.ok) {
      throw new Error(`Handshake HTTP error: ${response.status}`);
    }

    return response.json() as Promise<PluginHandshakeResponse>;
  }
}

// ─── Manifest builder helper ──────────────────────────────────────────────────

/**
 * Helper to construct a validated plugin manifest object.
 * Equivalent to calling `parsePluginManifest(...)` with better TypeScript ergonomics.
 */
export function defineManifest(manifest: Parameters<typeof parsePluginManifest>[0]): PluginManifest {
  return parsePluginManifest(manifest);
}

// ─── Internal utilities ───────────────────────────────────────────────────────

async function pickFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      server.close(() => {
        if (addr && typeof addr === "object") {
          resolve(addr.port);
        } else {
          reject(new Error("Could not determine free port"));
        }
      });
    });
  });
}

function writeJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
  }
  return Buffer.concat(chunks).toString("utf8");
}
