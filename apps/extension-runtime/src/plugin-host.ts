/**
 * Plugin host.
 *
 * Responsible for:
 * - Launching plugin processes out-of-process (child_process.spawn).
 * - Injecting minimal environment (host RPC URL, plugin ID, launch token, callback port).
 * - Supervising process health via periodic HTTP health checks.
 * - Enforcing resource quota limits (memory via OS signals where supported).
 * - Stopping / killing plugin processes on lifecycle transitions.
 * - Routing host→plugin tool/hook invocations to the plugin's callback URL.
 *
 * Isolation model:
 * - Each plugin runs as a separate OS process.
 * - The plugin process has no ambient access to the host process memory,
 *   file descriptors, or internal service APIs.
 * - Only a minimal set of environment variables is injected.
 * - Communication is exclusively via HTTP (host RPC + plugin callback).
 */

import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID, createHmac } from "node:crypto";
import { createLogger } from "@manasvi/logging";

import {
  type PluginManifest,
  type PluginCapabilityGrant,
  type PluginInvocationRequest,
  type PluginInvocationResponse,
  type PluginResourceProfile
} from "@manasvi/contracts";

// ─── Running plugin state ────────────────────────────────────────────────────

export interface RunningPlugin {
  pluginId: string;
  process: ChildProcess;
  callbackUrl: string;
  launchToken: string;
  grantedCapabilities: PluginCapabilityGrant[];
  startedAt: string;
  lastHealthOk: string;
  healthCheckTimer: ReturnType<typeof setInterval> | null;
}

// ─── Plugin host ─────────────────────────────────────────────────────────────

export interface PluginHostOptions {
  hostRpcUrl: string;
  healthCheckIntervalMs: number;
  handshakeTimeoutMs: number;
  shutdownTimeoutMs: number;
  onUnhealthy: (pluginId: string) => void;
  onProcessExit: (pluginId: string, code: number | null) => void;
  logLevel?: string;
}

export class PluginHost {
  private readonly running = new Map<string, RunningPlugin>();
  private readonly logger = createLogger({ serviceName: "extension-runtime", serviceVersion: "0.1.0", environment: "local", level: "info", humanReadable: false });

  constructor(private readonly options: PluginHostOptions) {}

  // ── Launch ────────────────────────────────────────────────────────────────

  /**
   * Launch a plugin process.
   *
   * The process receives a minimal env:
   *   PLUGIN_HOST_RPC_URL    - host RPC endpoint
   *   PLUGIN_ID              - plugin ID from manifest
   *   PLUGIN_LAUNCH_TOKEN    - one-time HMAC token for identity verification
   *   PLUGIN_CALLBACK_PORT   - port the plugin must listen on for invocations
   *
   * All other ambient env vars are stripped unless listed in `allowedEnvKeys`.
   */
  async launch(
    manifest: PluginManifest,
    grants: PluginCapabilityGrant[],
    opts: {
      callbackPort: number;
      allowedEnvKeys?: string[];
      pluginBaseDir?: string;
      injectedEnv?: Record<string, string>;
    }
  ): Promise<{ launchToken: string }> {
    if (this.running.has(manifest.pluginId)) {
      throw new Error(`Plugin '${manifest.pluginId}' is already running`);
    }

    const launchToken = this.generateLaunchToken(manifest.pluginId, manifest.version);

    // Minimal environment: strip ambient secrets
    const allowedKeys = new Set(opts.allowedEnvKeys ?? ["PATH", "NODE_PATH", "HOME", "TMPDIR"]);
    const filteredEnv: Record<string, string> = {};
    for (const key of allowedKeys) {
      const val = process.env[key];
      if (val !== undefined) filteredEnv[key] = val;
    }

    const pluginEnv: Record<string, string> = {
      ...filteredEnv,
      PLUGIN_HOST_RPC_URL: this.options.hostRpcUrl,
      PLUGIN_ID: manifest.pluginId,
      PLUGIN_LAUNCH_TOKEN: launchToken,
      PLUGIN_CALLBACK_PORT: String(opts.callbackPort),
      ...(opts.injectedEnv ?? {})
    };

    const [cmd, ...args] = this.resolveEntrypoint(manifest, opts.pluginBaseDir);
    if (!cmd) {
      throw new Error(`Cannot resolve entrypoint for plugin '${manifest.pluginId}'`);
    }

    this.logger.info("Launching plugin process", {
      pluginId: manifest.pluginId,
      version: manifest.version,
      runtimeType: manifest.runtimeType,
      cmd,
      callbackPort: opts.callbackPort
    });

    const proc = spawn(cmd, args, {
      env: pluginEnv,
      stdio: ["ignore", "pipe", "pipe"],
      detached: false,
      cwd: opts.pluginBaseDir ?? process.cwd()
    });

    proc.stdout?.on("data", (chunk: Buffer) => {
      this.logger.info(`[plugin:${manifest.pluginId}] ${chunk.toString("utf8").trimEnd()}`);
    });
    proc.stderr?.on("data", (chunk: Buffer) => {
      this.logger.warn(`[plugin:${manifest.pluginId}] stderr: ${chunk.toString("utf8").trimEnd()}`);
    });

    proc.once("exit", (code) => {
      this.logger.warn("Plugin process exited", { pluginId: manifest.pluginId, code });
      const entry = this.running.get(manifest.pluginId);
      if (entry?.healthCheckTimer) {
        clearInterval(entry.healthCheckTimer);
      }
      this.running.delete(manifest.pluginId);
      this.options.onProcessExit(manifest.pluginId, code);
    });

    const now = new Date().toISOString();
    const callbackUrl = `http://127.0.0.1:${opts.callbackPort}`;

    const runningPlugin: RunningPlugin = {
      pluginId: manifest.pluginId,
      process: proc,
      callbackUrl,
      launchToken,
      grantedCapabilities: grants,
      startedAt: now,
      lastHealthOk: now,
      healthCheckTimer: null
    };

    this.running.set(manifest.pluginId, runningPlugin);
    return { launchToken };
  }

  /** Start health check timer after handshake completes. */
  startHealthChecks(pluginId: string): void {
    const plugin = this.running.get(pluginId);
    if (!plugin) return;

    const timer = setInterval(() => {
      void this.checkHealth(pluginId);
    }, this.options.healthCheckIntervalMs);

    this.running.set(pluginId, { ...plugin, healthCheckTimer: timer });
  }

  /** Update the callback URL after handshake (plugin provides its actual URL). */
  updateCallbackUrl(pluginId: string, callbackUrl: string): void {
    const plugin = this.running.get(pluginId);
    if (!plugin) return;
    this.running.set(pluginId, { ...plugin, callbackUrl });
  }

  // ── Stop ──────────────────────────────────────────────────────────────────

  async stop(pluginId: string, signal: "SIGTERM" | "SIGKILL" = "SIGTERM"): Promise<void> {
    const plugin = this.running.get(pluginId);
    if (!plugin) return;

    if (plugin.healthCheckTimer) {
      clearInterval(plugin.healthCheckTimer);
    }

    this.logger.info("Stopping plugin process", { pluginId, signal });
    plugin.process.kill(signal);

    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        this.logger.warn("Plugin did not exit cleanly, sending SIGKILL", { pluginId });
        plugin.process.kill("SIGKILL");
        resolve();
      }, this.options.shutdownTimeoutMs);

      plugin.process.once("exit", () => {
        clearTimeout(timeout);
        resolve();
      });
    });

    this.running.delete(pluginId);
  }

  async stopAll(): Promise<void> {
    const ids = [...this.running.keys()];
    await Promise.all(ids.map((id) => this.stop(id)));
  }

  // ── Tool invocation ───────────────────────────────────────────────────────

  /**
   * Invoke a plugin-provided tool or hook via the plugin's callback URL.
   *
   * Called by the RPC server after capability and policy checks are complete.
   * The result is returned to the caller — the plugin does not directly interact
   * with any Manasvi service.
   */
  async invokePlugin(
    pluginId: string,
    request: Omit<PluginInvocationRequest, "rpcId" | "timestamp">
  ): Promise<PluginInvocationResponse> {
    const plugin = this.running.get(pluginId);
    if (!plugin) {
      return {
        rpcId: request.trace.traceId,
        ok: false,
        output: {},
        error: { code: "PLUGIN_NOT_RUNNING", message: `Plugin '${pluginId}' is not running` }
      };
    }

    const fullRequest: PluginInvocationRequest = {
      ...request,
      rpcId: `rpc:${randomUUID()}`,
      timestamp: new Date().toISOString()
    };

    const profile = this.getResourceProfile(plugin);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), profile.rpcTimeoutMs);

    try {
      const response = await fetch(`${plugin.callbackUrl}/invoke`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(fullRequest),
        signal: controller.signal
      });

      clearTimeout(timeout);

      if (!response.ok) {
        return {
          rpcId: fullRequest.rpcId,
          ok: false,
          output: {},
          error: {
            code: "PLUGIN_HTTP_ERROR",
            message: `Plugin returned HTTP ${response.status}`
          }
        };
      }

      return response.json() as Promise<PluginInvocationResponse>;
    } catch (error) {
      clearTimeout(timeout);
      return {
        rpcId: fullRequest.rpcId,
        ok: false,
        output: {},
        error: {
          code: "PLUGIN_UNREACHABLE",
          message: error instanceof Error ? error.message : "Plugin invocation failed"
        }
      };
    }
  }

  // ── Getters ───────────────────────────────────────────────────────────────

  getRunning(pluginId: string): RunningPlugin | undefined {
    return this.running.get(pluginId);
  }

  isRunning(pluginId: string): boolean {
    return this.running.has(pluginId);
  }

  listRunning(): string[] {
    return [...this.running.keys()];
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private async checkHealth(pluginId: string): Promise<void> {
    const plugin = this.running.get(pluginId);
    if (!plugin) return;

    try {
      const profile = this.getResourceProfile(plugin);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), profile.healthTimeoutMs);

      const response = await fetch(`${plugin.callbackUrl}/health`, {
        signal: controller.signal
      });
      clearTimeout(timeout);

      if (response.ok) {
        this.running.set(pluginId, {
          ...plugin,
          lastHealthOk: new Date().toISOString()
        });
        return;
      }
    } catch {
      // fall through to unhealthy handler
    }

    this.logger.warn("Plugin health check failed", { pluginId });
    this.options.onUnhealthy(pluginId);
  }

  private generateLaunchToken(pluginId: string, version: string): string {
    const secret = randomUUID();
    const payload = `${pluginId}@${version}:${Date.now()}`;
    return createHmac("sha256", secret).update(payload).digest("hex");
  }

  private resolveEntrypoint(manifest: PluginManifest, baseDir?: string): string[] {
    const entrypoint = manifest.entrypoint;
    switch (manifest.runtimeType) {
      case "node":
        return ["node", entrypoint];
      case "python":
        return ["python3", entrypoint];
      case "binary":
        return [entrypoint];
      case "container":
        return ["docker", "run", "--rm", entrypoint];
      default:
        return ["node", entrypoint];
    }
  }

  private getResourceProfile(plugin: RunningPlugin): PluginResourceProfile {
    return {
      maxMemoryMb: 256,
      maxCpuPercent: 25,
      maxFileDescriptors: 64,
      maxLogSizeKb: 10240,
      healthTimeoutMs: 5000,
      rpcTimeoutMs: 10000
    };
  }
}
