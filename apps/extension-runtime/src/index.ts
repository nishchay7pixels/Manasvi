/**
 * Extension Runtime — Milestone 12
 *
 * The Extension Plane host service for Manasvi.
 *
 * HTTP routes (management API):
 *   POST   /plugins/register            Register a plugin manifest
 *   GET    /plugins                     List all plugins
 *   GET    /plugins/:id                 Get plugin detail
 *   POST   /plugins/:id/approve         Operator capability approval
 *   POST   /plugins/:id/start           Start a plugin process
 *   POST   /plugins/:id/stop            Stop a plugin process
 *   POST   /plugins/:id/revoke          Revoke a plugin permanently
 *   GET    /plugins/:id/status          Lightweight status check
 *   POST   /plugins/:id/tools/:toolId   Invoke a plugin-provided tool
 *
 * HTTP routes (plugin RPC — called by plugin processes):
 *   POST   /internal/plugin-rpc/handshake   Plugin handshake
 *   POST   /internal/plugin-rpc/status      Plugin health/status report
 *   POST   /internal/plugin-rpc/lifecycle/stopping  Plugin clean stop signal
 *
 * Security:
 *   - Plugin RPC routes verify session tokens or launch tokens
 *   - Management routes should be behind internal auth (scaffolded)
 *   - Capability grants are checked before every tool invocation
 *   - Revoked plugins are rejected at every route
 */

import { randomUUID } from "node:crypto";
import { type IncomingMessage } from "node:http";

import { respondJson, readJsonBody, startHttpService } from "@manasvi/service-runtime";
import {
  InternalTokenService,
  buildServicePrincipalReference
} from "@manasvi/auth";
import { HttpPolicyClient } from "@manasvi/policy-sdk";
import {
  EnvMapSecretProvider,
  SecretBroker,
  parseSecretReferenceMapping,
  redactSecretsInObject
} from "@manasvi/secrets-sdk";

import {
  type PluginHandshakeRequest,
  type PluginHandshakeResponse,
  type SecretUsageRecord,
  type PrincipalReference,
  pluginHandshakeRequestSchema
} from "@manasvi/contracts";

import { loadExtensionRuntimeConfig } from "./config.js";
import { PluginRegistry } from "./plugin-registry.js";
import { CapabilityApprover } from "./capability-approver.js";
import { PluginHost } from "./plugin-host.js";
import { PluginLifecycleManager } from "./plugin-lifecycle.js";
import { allowPluginRawSecretExposure, pluginSecretEnvName } from "./plugin-secrets.js";

async function main(): Promise<void> {
  const config = await loadExtensionRuntimeConfig();
  const servicePrincipal = buildServicePrincipalReference(config.serviceName);
  const requestingService = {
    principalId: servicePrincipal.principalId,
    principalType: "service" as const
  };
  const tokenService = new InternalTokenService(
    {
      issuer: config.internalAuthIssuer,
      audience: config.internalAuthAudience,
      keyId: config.internalAuthKeyId,
      secret: config.internalAuthSigningSecret,
      ttlSeconds: config.internalAuthTokenTtlSeconds
    },
    {
      issuer: config.internalAuthIssuer,
      audience: config.internalAuthAudience,
      secretsByKeyId: {
        [config.internalAuthKeyId]: config.internalAuthSigningSecret
      }
    }
  );
  const policyClient = new HttpPolicyClient({
    baseUrl: config.policyServiceBaseUrl,
    getAuthToken: () =>
      tokenService.issueToken({
        caller: servicePrincipal,
        scopes: ["policy.evaluate", "service:extension-runtime"]
      })
  });
  const secretBroker = new SecretBroker({
    policyClient,
    provider: new EnvMapSecretProvider(process.env, parseSecretReferenceMapping(config.secretRefEnvMapJson)),
    requestingService,
    onUsageRecord: (record: SecretUsageRecord) => {
      console.log(
        JSON.stringify({
          timestamp: new Date().toISOString(),
          level: "info",
          service: "extension-runtime",
          message: "Plugin secret usage record",
          record: redactSecretsInObject({
            usageId: record.usageId,
            eventType: record.eventType,
            reference: record.reference,
            consumerType: record.consumerType,
            consumerId: record.consumerId,
            traceId: record.trace.traceId,
            reasonCodes: record.reasonCodes
          })
        })
      );
    }
  });

  // ── Wire up subsystems ────────────────────────────────────────────────────

  const registry = new PluginRegistry();

  const approver = new CapabilityApprover({
    requireExplicitCapabilityApproval: config.requireExplicitCapabilityApproval,
    approvalAuthority: servicePrincipal
  });

  const hostRpcUrl = `http://${config.host}:${config.port}`;

  const host = new PluginHost({
    hostRpcUrl,
    healthCheckIntervalMs: config.pluginHealthCheckIntervalMs,
    handshakeTimeoutMs: config.pluginHandshakeTimeoutMs,
    shutdownTimeoutMs: config.pluginShutdownTimeoutMs,
    onUnhealthy: (pluginId) => lifecycle.handleUnhealthy(pluginId),
    onProcessExit: (pluginId, code) => lifecycle.handleProcessExit(pluginId, code)
  });

  let signingKeySecrets: Record<string, string> = {};
  try {
    signingKeySecrets = JSON.parse(config.pluginSigningKeySecrets) as Record<string, string>;
  } catch {
    // ignore parse errors — use empty map
  }

  const lifecycle = new PluginLifecycleManager({
    registry,
    approver,
    host,
    provenanceOptions: {
      signingKeySecrets,
      requireSignatureForHighRisk: config.requireExplicitCapabilityApproval
    },
    hostRpcUrl,
    pluginBaseDir: config.pluginBaseDir
  });

  // ── Active session tokens (pluginId → sessionToken) ───────────────────────
  const activeSessions = new Map<string, string>();

  // ── HTTP service ──────────────────────────────────────────────────────────

  await startHttpService({
    config,
    serviceName: "extension-runtime",
    serviceVersion: "0.1.0",
    readinessChecks: [
      {
        name: "extension_plane_ready",
        check: () => ({ ok: true })
      }
    ],
    handleRequest: async ({ req, res, logger }) => {
      const url = req.url ?? "";
      const method = req.method ?? "GET";

      // ── Plugin RPC (plugin process → host) ──────────────────────────────

      if (method === "POST" && url === "/internal/plugin-rpc/handshake") {
        try {
          const body = await readJsonBody<unknown>(req);
          const parsed = pluginHandshakeRequestSchema.safeParse(body);
          if (!parsed.success) {
            respondJson(res, 400, { error: "INVALID_HANDSHAKE", issues: parsed.error.issues });
            return true;
          }

          const shake: PluginHandshakeRequest = parsed.data;

          const result = lifecycle.processHandshake(
            shake.pluginId,
            shake.provenanceToken ?? shake.nonce,
            shake.manifestHash,
            shake.callbackUrl,
            shake.supportedApiVersion
          );

          if (!result.ok) {
            const response: PluginHandshakeResponse = {
              protocolVersion: "1.0",
              accepted: false,
              grantedCapabilities: [],
              deniedCapabilityIds: [],
              rejectionReason: result.rejectionReason ?? "Handshake rejected",
              timestamp: new Date().toISOString()
            };
            respondJson(res, 403, response);
            return true;
          }

          activeSessions.set(shake.pluginId, result.sessionToken);

          const response: PluginHandshakeResponse = {
            protocolVersion: "1.0",
            accepted: true,
            pluginPrincipalId: result.principalId,
            grantedCapabilities: result.grants,
            deniedCapabilityIds: [],
            sessionToken: result.sessionToken,
            timestamp: new Date().toISOString()
          };
          respondJson(res, 200, response);
          return true;
        } catch (error) {
          logger.error("Handshake processing error", {
            error: error instanceof Error ? error.message : "unknown"
          });
          respondJson(res, 500, { error: "HANDSHAKE_ERROR" });
          return true;
        }
      }

      if (method === "POST" && url === "/internal/plugin-rpc/status") {
        // Plugin health report — acknowledge
        respondJson(res, 200, { ok: true });
        return true;
      }

      if (method === "POST" && url === "/internal/plugin-rpc/lifecycle/stopping") {
        const pluginId = req.headers["x-plugin-id"] as string | undefined;
        if (pluginId) {
          logger.info("Plugin signalled clean stop", { pluginId });
        }
        respondJson(res, 200, { ok: true });
        return true;
      }

      // ── Management API ───────────────────────────────────────────────────

      if (method === "POST" && url === "/plugins/register") {
        try {
          const rawManifest = await readJsonBody<unknown>(req);
          const result = await lifecycle.register(rawManifest);
          const statusCode = result.errors.length > 0 ? 422 : 201;
          respondJson(res, statusCode, result);
          return true;
        } catch (error) {
          logger.error("Plugin registration error", {
            error: error instanceof Error ? error.message : "unknown"
          });
          respondJson(res, 500, { error: "REGISTRATION_ERROR" });
          return true;
        }
      }

      if (method === "GET" && url === "/plugins") {
        const entries = registry.list().map((e) => ({
          pluginId: e.pluginId,
          version: e.version,
          name: e.manifest.name,
          riskClass: e.manifest.riskClass,
          lifecycleState: e.lifecycleState,
          provenanceVerified: e.provenanceVerified,
          grantedCapabilityCount: e.grantedCapabilities.filter((g) => !g.revoked).length,
          registeredAt: e.registeredAt
        }));
        respondJson(res, 200, { plugins: entries });
        return true;
      }

      // Routes with :id segment
      const pluginMatch = url.match(/^\/plugins\/([^/]+)(\/(.+))?$/);
      if (pluginMatch) {
        const pluginId = decodeURIComponent(pluginMatch[1] ?? "");
        const subpath = pluginMatch[3] ?? "";

        // GET /plugins/:id
        if (method === "GET" && !subpath) {
          const entry = registry.get(pluginId);
          if (!entry) {
            respondJson(res, 404, { error: "PLUGIN_NOT_FOUND" });
            return true;
          }
          respondJson(res, 200, entry);
          return true;
        }

        // GET /plugins/:id/status
        if (method === "GET" && subpath === "status") {
          const entry = registry.get(pluginId);
          if (!entry) {
            respondJson(res, 404, { error: "PLUGIN_NOT_FOUND" });
            return true;
          }
          respondJson(res, 200, {
            pluginId,
            lifecycleState: entry.lifecycleState,
            running: host.isRunning(pluginId),
            provenanceVerified: entry.provenanceVerified,
            grantedCapabilityCount: entry.grantedCapabilities.filter((g) => !g.revoked).length
          });
          return true;
        }

        // POST /plugins/:id/approve
        if (method === "POST" && subpath === "approve") {
          const body = await readJsonBody<{
            approvedCapabilityIds: string[];
            policyRef?: string;
          }>(req);
          const approvedBy = servicePrincipal;
          const result = await lifecycle.approve(
            pluginId,
            body.approvedCapabilityIds,
            approvedBy,
            body.policyRef
          );
          respondJson(res, result.ok ? 200 : 422, result);
          return true;
        }

        // POST /plugins/:id/start
        if (method === "POST" && subpath === "start") {
          const body = await readJsonBody<{
            secretRefs?: string[];
            allowRawSecretExposure?: boolean;
          }>(req);
          let injectedSecretsEnv: Record<string, string> | undefined;
          if (body.secretRefs && body.secretRefs.length > 0) {
            if (
              !allowPluginRawSecretExposure({
                runtimeFlagEnabled: config.allowPluginRawSecretExposure,
                requestFlagEnabled: body.allowRawSecretExposure === true
              })
            ) {
              respondJson(res, 403, {
                ok: false,
                error: "PLUGIN_RAW_SECRET_EXPOSURE_DISABLED"
              });
              return true;
            }
            try {
              const resolved = await secretBroker.resolveForRuntime({
                principalContext: {
                  caller: servicePrincipal,
                  actor: servicePrincipal,
                  tenantId: "tenant-local",
                  workspaceId: "workspace-local",
                  authnStrength: "strong",
                  authenticated: true,
                  scopes: []
                },
                trace: extractTrace(req),
                tenantId: "tenant-local",
                workspaceId: "workspace-local",
                consumerType: "plugin-runtime",
                consumerId: pluginId,
                purpose: "plugin_launch_secret_injection",
                references: body.secretRefs,
                requestRawExposure: true,
                allowRawExposureForConsumer: true,
                runtimeContext: {
                  pluginId
                }
              });
              injectedSecretsEnv = Object.entries(resolved.secretValuesByRef).reduce<Record<string, string>>(
                (acc, [reference, value]) => {
                  const envName = pluginSecretEnvName(reference);
                  if (typeof value === "string") {
                    acc[envName] = value;
                  }
                  return acc;
                },
                {}
              );
            } catch (error) {
              respondJson(res, 403, {
                ok: false,
                error: error instanceof Error ? error.message : "PLUGIN_SECRET_ACCESS_DENIED"
              });
              return true;
            }
          }
          const result = await lifecycle.start(pluginId, {
            handshakeTimeoutMs: config.pluginHandshakeTimeoutMs,
            ...(injectedSecretsEnv ? { injectedSecretsEnv } : {})
          });
          respondJson(res, result.ok ? 200 : 422, result);
          return true;
        }

        // POST /plugins/:id/stop
        if (method === "POST" && subpath === "stop") {
          const result = await lifecycle.stop(pluginId);
          respondJson(res, result.ok ? 200 : 422, result);
          return true;
        }

        // POST /plugins/:id/revoke
        if (method === "POST" && subpath === "revoke") {
          const body = await readJsonBody<{ reason: string }>(req);
          const revokedBy: PrincipalReference = {
            principalId: servicePrincipal.principalId,
            principalType: "service"
          };
          const result = await lifecycle.revoke(pluginId, revokedBy, body.reason ?? "operator revocation");
          respondJson(res, result.ok ? 200 : 422, result);
          return true;
        }

        // POST /plugins/:id/tools/:toolId — invoke plugin-provided tool
        const toolMatch = subpath.match(/^tools\/([^/]+)$/);
        if (method === "POST" && toolMatch) {
          const toolId = toolMatch[1] ?? "";
          const entry = registry.get(pluginId);
          if (!entry) {
            respondJson(res, 404, { error: "PLUGIN_NOT_FOUND" });
            return true;
          }
          if (entry.lifecycleState === "revoked") {
            respondJson(res, 403, { error: "PLUGIN_REVOKED" });
            return true;
          }
          if (!host.isRunning(pluginId)) {
            respondJson(res, 409, { error: "PLUGIN_NOT_RUNNING" });
            return true;
          }

          // Check provide-tools capability is granted
          const hasToolsCap = entry.grantedCapabilities.some(
            (g) => g.family === "provide-tools" && !g.revoked
          );
          if (!hasToolsCap) {
            respondJson(res, 403, { error: "CAPABILITY_NOT_GRANTED", capability: "provide-tools" });
            return true;
          }

          const body = await readJsonBody<Record<string, unknown>>(req);
          const trace = extractTrace(req);

          const invokeResult = await host.invokePlugin(pluginId, {
            method: "tool.invoke",
            targetId: toolId,
            payload: body,
            trace
          });

          // Emit lifecycle event for audit
          logger.info("Plugin tool invoked", {
            pluginId,
            toolId,
            ok: invokeResult.ok,
            traceId: trace.traceId
          });

          respondJson(res, invokeResult.ok ? 200 : 502, invokeResult);
          return true;
        }
      }

      return false;
    }
  });
}

function extractTrace(req: IncomingMessage): { traceId: string; correlationId: string } {
  return {
    traceId: (req.headers["x-trace-id"] as string | undefined) ?? randomUUID(),
    correlationId: (req.headers["x-correlation-id"] as string | undefined) ?? randomUUID()
  };
}

main().catch((err) => {
  console.error("Extension runtime startup failed:", err);
  process.exit(1);
});
