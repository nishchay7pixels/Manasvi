import { resolve } from "node:path";

import { CONTRACT_SCHEMA_VERSION } from "@manasvi/contracts";
import { InternalTokenService, buildServicePrincipalReference } from "@manasvi/auth";
import { readJsonBody, respondJson, startHttpService } from "@manasvi/service-runtime";
import { AuditClient } from "@manasvi/audit-sdk";
import { HttpPolicyClient } from "@manasvi/policy-sdk";
import {
  GOOGLE_ACTION_CATALOG,
  ConnectorRegistry,
  EncryptedTokenVault,
  FetchOAuthClient,
  FetchGmailApiClient,
  GOOGLE_PROVIDER_PROFILE,
  GmailReadConnector,
  IntegrationAccountStore,
  OAuthFlowService,
  OAuthStateStore,
  buildGoogleAuthorizationSnapshot,
  buildGooglePermissionAuditEvent,
  checkGoogleActionPermission,
  createGoogleConnector
} from "@manasvi/integrations-sdk";
import { z } from "zod";

import { loadApiGatewayConfig } from "./config.js";
import { buildIngressSubmission, pollForEventResult } from "./harness.js";

const harnessRequestSchema = z.object({
  tenantId: z.string().min(1),
  workspaceId: z.string().min(1),
  message: z.string().min(1),
  actorPrincipalId: z.string().min(1).optional(),
  actorPrincipalType: z.enum(["human_user", "agent"]).optional(),
  channelPrincipalId: z.string().min(1).optional(),
  channelMessageId: z.string().min(1).optional(),
  sessionId: z.string().min(1).optional(),
  conversationId: z.string().min(1).optional()
});

const integrationStartSchema = z.object({
  scopes: z.array(z.string().min(1)).optional(),
  actorPrincipalId: z.string().min(1).optional(),
  tenantId: z.string().min(1).optional(),
  workspaceId: z.string().min(1).optional(),
  returnTo: z.string().optional()
});

const googlePermissionCheckSchema = z.object({
  actionId: z.enum([
    "gmail.threads.read",
    "gmail.draft.create",
    "gmail.message.send",
    "calendar.events.read",
    "calendar.events.write",
    "drive.files.read",
    "drive.files.write",
    "docs.document.read",
    "docs.document.write"
  ]),
  actorPrincipalId: z.string().min(1).default("user:local-operator"),
  actorPrincipalType: z.enum(["human_user", "agent", "plugin"]).default("human_user"),
  tenantId: z.string().min(1).default("tenant-local"),
  workspaceId: z.string().min(1).default("workspace-local"),
  pluginId: z.string().min(1).optional()
});

const gmailListSchema = z.object({
  query: z.string().optional(),
  labelIds: z.array(z.string().min(1)).optional(),
  maxResults: z.number().int().positive().max(50).optional(),
  pageToken: z.string().optional(),
  includeSpamTrash: z.boolean().optional(),
  actorPrincipalId: z.string().min(1).default("user:local-operator"),
  actorPrincipalType: z.enum(["human_user", "agent", "plugin"]).default("human_user"),
  tenantId: z.string().min(1).default("tenant-local"),
  workspaceId: z.string().min(1).default("workspace-local"),
  pluginId: z.string().min(1).optional()
});

const gmailGetSchema = z.object({
  actorPrincipalId: z.string().min(1).default("user:local-operator"),
  actorPrincipalType: z.enum(["human_user", "agent", "plugin"]).default("human_user"),
  tenantId: z.string().min(1).default("tenant-local"),
  workspaceId: z.string().min(1).default("workspace-local"),
  pluginId: z.string().min(1).optional()
});

async function main(): Promise<void> {
  const config = await loadApiGatewayConfig();
  const servicePrincipal = buildServicePrincipalReference(config.serviceName);
  const tokenService = new InternalTokenService(
    {
      issuer: config.internalAuthIssuer,
      audience: config.internalAuthAudience,
      keyId: config.internalAuthKeyId,
      secret: config.internalAuthSigningSecret,
      ttlSeconds: 120
    },
    {
      issuer: config.internalAuthIssuer,
      audience: config.internalAuthAudience,
      secretsByKeyId: {
        [config.internalAuthKeyId]: config.internalAuthSigningSecret
      }
    }
  );

  const issueServiceToken = (scopes: string[]): string =>
    tokenService.issueToken({
      caller: servicePrincipal,
      scopes
    });

  const integrationsRoot = process.cwd();
  const registry = new ConnectorRegistry();
  registry.register(createGoogleConnector());
  const stateStore = new OAuthStateStore(resolve(integrationsRoot, config.integrationsStateFile));
  const accountStore = new IntegrationAccountStore(resolve(integrationsRoot, config.integrationsAccountsFile));
  const tokenVault = new EncryptedTokenVault(
    resolve(integrationsRoot, config.integrationsTokensFile),
    config.integrationsTokenEncryptionSecret
  );
  const oauth = new OAuthFlowService({
    connectorRegistry: registry,
    stateStore,
    accountStore,
    tokenVault,
    oauthClient: new FetchOAuthClient(),
    providerProfile: GOOGLE_PROVIDER_PROFILE,
    clientId: config.googleOAuthClientId,
    clientSecret: config.googleOAuthClientSecret,
    defaultRedirectUri: config.googleOAuthRedirectUri
  });
  const gmail = new GmailReadConnector(new FetchGmailApiClient());

  const clientIdPrefix = config.googleOAuthClientId.slice(0, 18);
  const clientIdSuffix = config.googleOAuthClientId.slice(-12);
  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level: "info",
      service: "api-gateway",
      message: "Google OAuth config loaded",
      googleOAuthClientIdFingerprint: `${clientIdPrefix}...${clientIdSuffix}`,
      googleOAuthRedirectUri: config.googleOAuthRedirectUri
    })
  );

  const audit = new AuditClient({
    auditServiceUrl: config.auditServiceBaseUrl,
    serviceName: "api-gateway"
  });
  const policyClient = new HttpPolicyClient({
    baseUrl: config.policyServiceBaseUrl,
    getAuthToken: () => issueServiceToken(["service:api-gateway", "policy.evaluate"])
  });

  await startHttpService({
    config,
    serviceName: "api-gateway",
    serviceVersion: config.serviceVersion,
    readinessChecks: [{ name: "routing_table_initialized", check: async () => ({ ok: true }) }],
    handleRequest: async ({ req, res, trace, logger }) => {
      const reqUrl = new URL(req.url ?? "/", `http://${req.headers.host ?? "127.0.0.1"}`);
      if (req.method === "GET" && reqUrl.pathname === "/") {
        respondJson(res, 200, {
          schemaVersion: CONTRACT_SCHEMA_VERSION,
          service: config.serviceName,
          plane: "gateway",
          trace
        });
        return true;
      }
      if (req.method === "GET" && reqUrl.pathname === "/routes") {
        respondJson(res, 200, {
          schemaVersion: CONTRACT_SCHEMA_VERSION,
          routes: [
            { path: "/ingress/events", upstream: config.ingressBaseUrl },
            { path: "/orchestration/plan", upstream: config.orchestratorBaseUrl },
            { path: "/test-harness/chat", upstream: "gateway-local" }
          ]
        });
        return true;
      }

      if (req.method === "GET" && reqUrl.pathname === "/integrations/connectors") {
        respondJson(res, 200, {
          schemaVersion: CONTRACT_SCHEMA_VERSION,
          connectors: registry.list()
        });
        return true;
      }

      if (req.method === "GET" && reqUrl.pathname === "/integrations/accounts") {
        respondJson(res, 200, {
          schemaVersion: CONTRACT_SCHEMA_VERSION,
          accounts: await accountStore.list()
        });
        return true;
      }

      if (req.method === "GET" && reqUrl.pathname === "/integrations/accounts/google") {
        respondJson(res, 200, {
          schemaVersion: CONTRACT_SCHEMA_VERSION,
          account: await accountStore.getByProvider("google")
        });
        return true;
      }

      if (req.method === "GET" && reqUrl.pathname === "/integrations/google/authorization") {
        const account = await accountStore.getByProvider("google");
        respondJson(res, 200, {
          schemaVersion: CONTRACT_SCHEMA_VERSION,
          providerId: "google",
          authorization: buildGoogleAuthorizationSnapshot(account)
        });
        return true;
      }

      if (req.method === "GET" && reqUrl.pathname === "/integrations/google/actions") {
        respondJson(res, 200, {
          schemaVersion: CONTRACT_SCHEMA_VERSION,
          providerId: "google",
          actions: GOOGLE_ACTION_CATALOG
        });
        return true;
      }

      if (req.method === "POST" && reqUrl.pathname === "/integrations/google/connect/start") {
        const input = integrationStartSchema.parse(await readJsonBody(req));
        const flowInput: Parameters<OAuthFlowService["startGoogleFlow"]>[0] = {
          scopes: input.scopes ?? ["openid", "email", "profile"]
        };
        if (input.actorPrincipalId) flowInput.actorPrincipalId = input.actorPrincipalId;
        if (input.tenantId) flowInput.tenantId = input.tenantId;
        if (input.workspaceId) flowInput.workspaceId = input.workspaceId;
        if (input.returnTo) flowInput.returnTo = input.returnTo;
        const flow = await oauth.startGoogleFlow(flowInput);
        const auditPayload: Parameters<AuditClient["emit"]>[0] = {
          producingService: "api-gateway",
          eventType: "tool.invoked",
          severity: "info",
          traceId: trace.traceId,
          correlationId: trace.correlationId,
          reasonCodes: ["integration_connect_initiated"],
          payload: { providerId: "google", authorizeUrlIssued: true }
        };
        if (input.tenantId) auditPayload.tenantId = input.tenantId;
        if (input.workspaceId) auditPayload.workspaceId = input.workspaceId;
        audit.emit(auditPayload);
        respondJson(res, 200, {
          schemaVersion: CONTRACT_SCHEMA_VERSION,
          providerId: "google",
          status: "pending_auth",
          authorizeUrl: flow.authorizeUrl,
          stateExpiresAt: flow.stateExpiresAt
        });
        return true;
      }

      if (req.method === "GET" && reqUrl.pathname === "/integrations/oauth/google/callback") {
        const state = reqUrl.searchParams.get("state");
        const code = reqUrl.searchParams.get("code");
        const oauthError = reqUrl.searchParams.get("error");

        if (oauthError) {
          audit.emit({
            producingService: "api-gateway",
            eventType: "tool.failed",
            severity: "warn",
            traceId: trace.traceId,
            correlationId: trace.correlationId,
            reasonCodes: ["integration_connect_failed"],
            payload: { providerId: "google", error: oauthError }
          });
          respondJson(res, 400, {
            schemaVersion: CONTRACT_SCHEMA_VERSION,
            status: "error",
            providerId: "google",
            error: oauthError
          });
          return true;
        }

        if (!state || !code) {
          respondJson(res, 400, {
            schemaVersion: CONTRACT_SCHEMA_VERSION,
            status: "error",
            providerId: "google",
            error: "Missing state or code"
          });
          return true;
        }

        try {
          const account = await oauth.completeGoogleCallback({ state, code });
          audit.emit({
            producingService: "api-gateway",
            eventType: "tool.completed",
            severity: "info",
            traceId: trace.traceId,
            correlationId: trace.correlationId,
            reasonCodes: ["integration_connect_completed"],
            resource: {
              resourceClass: "integration-account",
              resourceId: account.accountId
            },
            payload: {
              providerId: "google",
              status: account.status,
              scopesGranted: account.scopesGranted
            }
          });
          respondJson(res, 200, {
            schemaVersion: CONTRACT_SCHEMA_VERSION,
            status: "connected",
            providerId: "google",
            account
          });
        } catch (error) {
          audit.emit({
            producingService: "api-gateway",
            eventType: "tool.failed",
            severity: "warn",
            traceId: trace.traceId,
            correlationId: trace.correlationId,
            reasonCodes: ["integration_connect_failed"],
            payload: { providerId: "google", error: error instanceof Error ? error.message : "unknown" }
          });
          respondJson(res, 400, {
            schemaVersion: CONTRACT_SCHEMA_VERSION,
            status: "error",
            providerId: "google",
            error: error instanceof Error ? error.message : "Unknown callback error"
          });
        }
        return true;
      }

      if (req.method === "POST" && reqUrl.pathname === "/integrations/google/refresh") {
        const account = await accountStore.getByProvider("google");
        if (!account) {
          respondJson(res, 404, { schemaVersion: CONTRACT_SCHEMA_VERSION, error: "Google integration not connected" });
          return true;
        }
        try {
          const updated = await oauth.refreshGoogle(account);
          audit.emit({
            producingService: "api-gateway",
            eventType: "tool.completed",
            severity: "info",
            traceId: trace.traceId,
            correlationId: trace.correlationId,
            reasonCodes: ["integration_refresh_succeeded"],
            resource: { resourceClass: "integration-account", resourceId: updated.accountId },
            payload: { providerId: "google", status: updated.status }
          });
          respondJson(res, 200, { schemaVersion: CONTRACT_SCHEMA_VERSION, account: updated });
        } catch (error) {
          await accountStore.setStatus(account.accountId, "refresh_failed", error instanceof Error ? error.message : "unknown");
          audit.emit({
            producingService: "api-gateway",
            eventType: "tool.failed",
            severity: "warn",
            traceId: trace.traceId,
            correlationId: trace.correlationId,
            reasonCodes: ["integration_refresh_failed"],
            resource: { resourceClass: "integration-account", resourceId: account.accountId },
            payload: { providerId: "google", error: error instanceof Error ? error.message : "unknown" }
          });
          respondJson(res, 400, {
            schemaVersion: CONTRACT_SCHEMA_VERSION,
            error: error instanceof Error ? error.message : "Unknown refresh error"
          });
        }
        return true;
      }

      if (req.method === "POST" && reqUrl.pathname === "/integrations/google/disconnect") {
        const account = await accountStore.getByProvider("google");
        if (!account) {
          respondJson(res, 404, { schemaVersion: CONTRACT_SCHEMA_VERSION, error: "Google integration not connected" });
          return true;
        }
        const disconnected = await oauth.disconnectGoogle(account);
        audit.emit({
          producingService: "api-gateway",
          eventType: "tool.completed",
          severity: "info",
          traceId: trace.traceId,
          correlationId: trace.correlationId,
          reasonCodes: ["integration_revoked"],
          resource: { resourceClass: "integration-account", resourceId: disconnected.accountId },
          payload: { providerId: "google", status: disconnected.status }
        });
        respondJson(res, 200, {
          schemaVersion: CONTRACT_SCHEMA_VERSION,
          providerId: "google",
          account: disconnected
        });
        return true;
      }

      if (req.method === "POST" && reqUrl.pathname === "/integrations/google/permissions/check") {
        const input = googlePermissionCheckSchema.parse(await readJsonBody(req));
        const account = await accountStore.getByProvider("google");
        const actor = {
          principalId: input.actorPrincipalId,
          principalType: input.actorPrincipalType,
          tenantId: input.tenantId,
          workspaceId: input.workspaceId
        } as const;
        const caller = input.pluginId
          ? ({
              principalId: input.pluginId,
              principalType: "plugin",
              tenantId: input.tenantId,
              workspaceId: input.workspaceId
            } as const)
          : ({
              principalId: "service:api-gateway",
              principalType: "service",
              tenantId: input.tenantId,
              workspaceId: input.workspaceId
            } as const);

        const principalContext = {
          caller,
          actor,
          tenantId: input.tenantId,
          workspaceId: input.workspaceId,
          scopes: [] as string[],
          authnStrength: "strong" as const,
          authenticated: true
        };

        const permissionInput: Parameters<typeof checkGoogleActionPermission>[0] = {
          account,
          actionId: input.actionId,
          principalContext,
          actor,
          caller,
          tenantId: input.tenantId,
          workspaceId: input.workspaceId,
          trace: {
            traceId: trace.traceId,
            correlationId: trace.correlationId
          },
          policyClient
        };
        if (input.pluginId) {
          permissionInput.pluginId = input.pluginId;
        }
        const result = await checkGoogleActionPermission(permissionInput);
        const auditInput: Parameters<typeof buildGooglePermissionAuditEvent>[0] = {
          traceId: trace.traceId,
          correlationId: trace.correlationId,
          actor,
          caller,
          tenantId: input.tenantId,
          workspaceId: input.workspaceId,
          ...(account?.accountId ? { accountId: account.accountId } : {}),
          ...(input.pluginId ? { pluginId: input.pluginId } : {}),
          result
        };
        audit.emit(buildGooglePermissionAuditEvent(auditInput));

        respondJson(res, result.decision === "allow" ? 200 : result.decision === "require_approval" ? 202 : 403, {
          schemaVersion: CONTRACT_SCHEMA_VERSION,
          providerId: "google",
          permission: result
        });
        return true;
      }

      if (req.method === "GET" && reqUrl.pathname === "/integrations/google/gmail/health") {
        const account = await accountStore.getByProvider("google");
        let tokenPresent = false;
        if (account?.tokenReference) {
          const token = await tokenVault.get(account.tokenReference);
          tokenPresent = Boolean(token?.accessToken);
        }
        respondJson(res, 200, {
          schemaVersion: CONTRACT_SCHEMA_VERSION,
          providerId: "google",
          connector: "gmail-read",
          health: gmail.computeHealth(account, tokenPresent)
        });
        return true;
      }

      const gmailPath = reqUrl.pathname;
      const isGmailMessageGet = req.method === "GET" && /^\/integrations\/google\/gmail\/messages\/[^/]+$/.test(gmailPath);
      const isGmailThreadGet = req.method === "GET" && /^\/integrations\/google\/gmail\/threads\/[^/]+$/.test(gmailPath);

      const runGmailReadPermission = async (input: z.infer<typeof gmailGetSchema> | z.infer<typeof gmailListSchema>) => {
        const account = await accountStore.getByProvider("google");
        const actor = {
          principalId: input.actorPrincipalId,
          principalType: input.actorPrincipalType,
          tenantId: input.tenantId,
          workspaceId: input.workspaceId
        } as const;
        const caller = input.pluginId
          ? ({
              principalId: input.pluginId,
              principalType: "plugin",
              tenantId: input.tenantId,
              workspaceId: input.workspaceId
            } as const)
          : ({
              principalId: "service:api-gateway",
              principalType: "service",
              tenantId: input.tenantId,
              workspaceId: input.workspaceId
            } as const);
        const principalContext = {
          caller,
          actor,
          tenantId: input.tenantId,
          workspaceId: input.workspaceId,
          scopes: [] as string[],
          authnStrength: "strong" as const,
          authenticated: true
        };
        const permissionInput: Parameters<typeof checkGoogleActionPermission>[0] = {
          account,
          actionId: "gmail.threads.read",
          principalContext,
          actor,
          caller,
          tenantId: input.tenantId,
          workspaceId: input.workspaceId,
          trace: {
            traceId: trace.traceId,
            correlationId: trace.correlationId
          },
          policyClient
        };
        if (input.pluginId) permissionInput.pluginId = input.pluginId;
        const permission = await checkGoogleActionPermission(permissionInput);
        const auditInput: Parameters<typeof buildGooglePermissionAuditEvent>[0] = {
          traceId: trace.traceId,
          correlationId: trace.correlationId,
          actor,
          caller,
          tenantId: input.tenantId,
          workspaceId: input.workspaceId,
          ...(account?.accountId ? { accountId: account.accountId } : {}),
          ...(input.pluginId ? { pluginId: input.pluginId } : {}),
          result: permission
        };
        audit.emit(buildGooglePermissionAuditEvent(auditInput));

        if (permission.decision === "deny") {
          respondJson(res, 403, {
            schemaVersion: CONTRACT_SCHEMA_VERSION,
            providerId: "google",
            connector: "gmail-read",
            permission
          });
          return { allowed: false as const, account: null };
        }
        if (permission.decision === "require_approval") {
          respondJson(res, 202, {
            schemaVersion: CONTRACT_SCHEMA_VERSION,
            providerId: "google",
            connector: "gmail-read",
            permission
          });
          return { allowed: false as const, account: null };
        }
        if (!account?.tokenReference) {
          respondJson(res, 400, {
            schemaVersion: CONTRACT_SCHEMA_VERSION,
            error: "Google integration token reference missing"
          });
          return { allowed: false as const, account: null };
        }
        const token = await tokenVault.get(account.tokenReference);
        if (!token?.accessToken) {
          respondJson(res, 400, {
            schemaVersion: CONTRACT_SCHEMA_VERSION,
            error: "Google access token not available"
          });
          return { allowed: false as const, account: null };
        }
        return { allowed: true as const, account, accessToken: token.accessToken };
      };

      const handleGmailUpstreamError = (error: unknown): boolean => {
        const message = error instanceof Error ? error.message : "unknown";
        const matched = message.match(/Gmail API read failed \((\d+)\)/);
        if (!matched) return false;
        respondJson(res, 502, {
          schemaVersion: CONTRACT_SCHEMA_VERSION,
          providerId: "google",
          connector: "gmail-read",
          error: {
            code: "GMAIL_UPSTREAM_ERROR",
            message,
            upstreamStatus: Number(matched[1])
          }
        });
        return true;
      };

      if (req.method === "POST" && reqUrl.pathname === "/integrations/google/gmail/messages/list") {
        const input = gmailListSchema.parse(await readJsonBody(req));
        const gate = await runGmailReadPermission(input);
        if (!gate.allowed) return true;
        const gmailQuery = {
          ...(input.query ? { query: input.query } : {}),
          ...(input.labelIds ? { labelIds: input.labelIds } : {}),
          ...(input.maxResults ? { maxResults: input.maxResults } : {}),
          ...(input.pageToken ? { pageToken: input.pageToken } : {}),
          ...(input.includeSpamTrash ? { includeSpamTrash: true } : {})
        };
        audit.emit({
          producingService: "api-gateway",
          eventType: "tool.invoked",
          severity: "info",
          traceId: trace.traceId,
          correlationId: trace.correlationId,
          reasonCodes: ["gmail_list_requested"],
          payload: { providerId: "google", query: input.query ?? null, labelIds: input.labelIds ?? [] }
        });
        let result;
        try {
          result = await gmail.listMessages(gate.accessToken, gmailQuery);
        } catch (error) {
          if (handleGmailUpstreamError(error)) return true;
          throw error;
        }
        audit.emit({
          producingService: "api-gateway",
          eventType: "tool.completed",
          severity: "info",
          traceId: trace.traceId,
          correlationId: trace.correlationId,
          reasonCodes: ["gmail_list_completed"],
          payload: { providerId: "google", count: result.messages.length }
        });
        respondJson(res, 200, { schemaVersion: CONTRACT_SCHEMA_VERSION, providerId: "google", connector: "gmail-read", result });
        return true;
      }

      if (req.method === "POST" && reqUrl.pathname === "/integrations/google/gmail/messages/search") {
        const input = gmailListSchema.parse(await readJsonBody(req));
        const gate = await runGmailReadPermission(input);
        if (!gate.allowed) return true;
        const gmailQuery = {
          ...(input.query ? { query: input.query } : {}),
          ...(input.labelIds ? { labelIds: input.labelIds } : {}),
          ...(input.maxResults ? { maxResults: input.maxResults } : {}),
          ...(input.pageToken ? { pageToken: input.pageToken } : {}),
          ...(input.includeSpamTrash ? { includeSpamTrash: true } : {})
        };
        audit.emit({
          producingService: "api-gateway",
          eventType: "tool.invoked",
          severity: "info",
          traceId: trace.traceId,
          correlationId: trace.correlationId,
          reasonCodes: ["gmail_search_requested"],
          payload: { providerId: "google", query: input.query ?? null }
        });
        let result;
        try {
          result = await gmail.searchMessages(gate.accessToken, gmailQuery);
        } catch (error) {
          if (handleGmailUpstreamError(error)) return true;
          throw error;
        }
        audit.emit({
          producingService: "api-gateway",
          eventType: "tool.completed",
          severity: "info",
          traceId: trace.traceId,
          correlationId: trace.correlationId,
          reasonCodes: ["gmail_search_completed"],
          payload: { providerId: "google", count: result.messages.length }
        });
        respondJson(res, 200, { schemaVersion: CONTRACT_SCHEMA_VERSION, providerId: "google", connector: "gmail-read", result });
        return true;
      }

      if (req.method === "POST" && reqUrl.pathname === "/integrations/google/gmail/threads/list") {
        const input = gmailListSchema.parse(await readJsonBody(req));
        const gate = await runGmailReadPermission(input);
        if (!gate.allowed) return true;
        const gmailQuery = {
          ...(input.query ? { query: input.query } : {}),
          ...(input.labelIds ? { labelIds: input.labelIds } : {}),
          ...(input.maxResults ? { maxResults: input.maxResults } : {}),
          ...(input.pageToken ? { pageToken: input.pageToken } : {})
        };
        let result;
        try {
          result = await gmail.listThreads(gate.accessToken, gmailQuery);
        } catch (error) {
          if (handleGmailUpstreamError(error)) return true;
          throw error;
        }
        audit.emit({
          producingService: "api-gateway",
          eventType: "tool.completed",
          severity: "info",
          traceId: trace.traceId,
          correlationId: trace.correlationId,
          reasonCodes: ["gmail_thread_list_completed"],
          payload: { providerId: "google", count: result.threads.length }
        });
        respondJson(res, 200, { schemaVersion: CONTRACT_SCHEMA_VERSION, providerId: "google", connector: "gmail-read", result });
        return true;
      }

      if (isGmailMessageGet) {
        const input = gmailGetSchema.parse({
          actorPrincipalId: reqUrl.searchParams.get("actorPrincipalId") ?? undefined,
          actorPrincipalType: reqUrl.searchParams.get("actorPrincipalType") ?? undefined,
          tenantId: reqUrl.searchParams.get("tenantId") ?? undefined,
          workspaceId: reqUrl.searchParams.get("workspaceId") ?? undefined,
          pluginId: reqUrl.searchParams.get("pluginId") ?? undefined
        });
        const gate = await runGmailReadPermission(input);
        if (!gate.allowed) return true;
        const messageId = decodeURIComponent(gmailPath.split("/").pop() ?? "");
        let message;
        try {
          message = await gmail.getMessage(gate.accessToken, messageId, gate.account);
        } catch (error) {
          if (handleGmailUpstreamError(error)) return true;
          throw error;
        }
        respondJson(res, 200, {
          schemaVersion: CONTRACT_SCHEMA_VERSION,
          providerId: "google",
          connector: "gmail-read",
          message,
          ingestionRecord: gmail.toIngressRecord(message)
        });
        return true;
      }

      if (isGmailThreadGet) {
        const input = gmailGetSchema.parse({
          actorPrincipalId: reqUrl.searchParams.get("actorPrincipalId") ?? undefined,
          actorPrincipalType: reqUrl.searchParams.get("actorPrincipalType") ?? undefined,
          tenantId: reqUrl.searchParams.get("tenantId") ?? undefined,
          workspaceId: reqUrl.searchParams.get("workspaceId") ?? undefined,
          pluginId: reqUrl.searchParams.get("pluginId") ?? undefined
        });
        const gate = await runGmailReadPermission(input);
        if (!gate.allowed) return true;
        const threadId = decodeURIComponent(gmailPath.split("/").pop() ?? "");
        let thread;
        try {
          thread = await gmail.getThread(gate.accessToken, threadId, gate.account);
        } catch (error) {
          if (handleGmailUpstreamError(error)) return true;
          throw error;
        }
        respondJson(res, 200, {
          schemaVersion: CONTRACT_SCHEMA_VERSION,
          providerId: "google",
          connector: "gmail-read",
          thread
        });
        return true;
      }

      if (req.method === "POST" && reqUrl.pathname === "/integrations/google/gmail/attention") {
        const input = gmailListSchema.parse(await readJsonBody(req));
        const gate = await runGmailReadPermission(input);
        if (!gate.allowed) return true;
        let result;
        try {
          result = await gmail.searchMessages(gate.accessToken, {
            ...(input.labelIds ? { labelIds: input.labelIds } : {}),
            query: input.query ?? "in:inbox (is:unread OR is:important) newer_than:7d",
            maxResults: input.maxResults ?? 10
          });
        } catch (error) {
          if (handleGmailUpstreamError(error)) return true;
          throw error;
        }
        const items = result.messages.map((message) => ({
          messageId: message.messageId,
          threadId: message.threadId,
          subject: message.subject,
          from: message.from,
          timestamp: message.timestamp,
          unread: message.unread,
          important: message.important,
          snippet: message.snippet,
          needsAttention: message.unread || message.important
        }));
        respondJson(res, 200, {
          schemaVersion: CONTRACT_SCHEMA_VERSION,
          providerId: "google",
          connector: "gmail-read",
          summary: {
            total: items.length,
            unreadCount: items.filter((item) => item.unread).length,
            importantCount: items.filter((item) => item.important).length
          },
          items
        });
        return true;
      }

      if (req.method === "POST" && reqUrl.pathname === "/test-harness/chat") {
        const incoming = harnessRequestSchema.parse(await readJsonBody(req));
        const ingressPayload = buildIngressSubmission({
          tenantId: incoming.tenantId,
          workspaceId: incoming.workspaceId,
          message: incoming.message,
          ...(incoming.actorPrincipalId ? { actorPrincipalId: incoming.actorPrincipalId } : {}),
          ...(incoming.actorPrincipalType ? { actorPrincipalType: incoming.actorPrincipalType } : {}),
          ...(incoming.channelPrincipalId ? { channelPrincipalId: incoming.channelPrincipalId } : {}),
          ...(incoming.channelMessageId ? { channelMessageId: incoming.channelMessageId } : {}),
          ...(incoming.sessionId ? { sessionId: incoming.sessionId } : {}),
          ...(incoming.conversationId ? { conversationId: incoming.conversationId } : {})
        });
        const ingressResponse = await fetch(`${config.ingressBaseUrl}/ingress/events`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${issueServiceToken(["service:api-gateway", "ingress.submit"])}`,
            "x-trace-id": trace.traceId,
            "x-correlation-id": trace.correlationId
          },
          body: JSON.stringify(ingressPayload)
        });
        if (!ingressResponse.ok) {
          respondJson(res, 502, {
            schemaVersion: CONTRACT_SCHEMA_VERSION,
            accepted: false,
            stage: "ingress_submission_failed",
            statusCode: ingressResponse.status,
            detail: await ingressResponse.text(),
            trace
          });
          return true;
        }

        const ingressBody = (await ingressResponse.json()) as {
          accepted: boolean;
          eventId: string;
          eventType: string;
        };
        logger.info("Harness message submitted to ingress", {
          eventId: ingressBody.eventId,
          traceId: trace.traceId,
          correlationId: trace.correlationId
        });

        try {
          const result = await pollForEventResult({
            eventId: ingressBody.eventId,
            orchestratorBaseUrl: config.orchestratorBaseUrl,
            authToken: issueServiceToken(["service:api-gateway", "orchestration.read"]),
            traceId: trace.traceId,
            correlationId: trace.correlationId,
            timeoutMs: config.harnessPollTimeoutMs,
            intervalMs: config.harnessPollIntervalMs
          });
          respondJson(res, result.status === "completed" ? 200 : result.status === "awaiting_approval" ? 202 : 502, {
            schemaVersion: CONTRACT_SCHEMA_VERSION,
            accepted: result.status === "completed",
            eventId: ingressBody.eventId,
            trace,
            result: result.result
          });
          return true;
        } catch (error) {
          respondJson(res, 504, {
            schemaVersion: CONTRACT_SCHEMA_VERSION,
            accepted: false,
            stage: "orchestrator_result_timeout",
            eventId: ingressBody.eventId,
            error: error instanceof Error ? error.message : "unknown",
            trace
          });
          return true;
        }
      }
      return false;
    }
  });
}

void main().catch((error) => {
  console.error(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level: "error",
      service: "api-gateway",
      message: "Service bootstrap failed",
      error: error instanceof Error ? error.message : "unknown"
    })
  );
  process.exit(1);
});
