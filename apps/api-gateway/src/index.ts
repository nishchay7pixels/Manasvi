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
  GmailWriteConnector,
  IntegrationAccountStore,
  OAuthFlowService,
  OAuthStateStore,
  buildGoogleAuthorizationSnapshot,
  buildGooglePermissionAuditEvent,
  checkGoogleActionPermission,
  createGoogleConnector,
  type GmailRecipient
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
    "gmail.draft.reply",
    "gmail.message.send",
    "gmail.message.archive",
    "gmail.message.label",
    "calendar.events.read",
    "calendar.events.write",
    "drive.files.read",
    "drive.files.write",
    "docs.document.read",
    "docs.document.write"
  ]),
  actorPrincipalId: z.string().min(1).default("user:local-operator"),
  actorPrincipalType: z.preprocess(
    (value) => (value === "user" ? "human_user" : value),
    z.enum(["human_user", "agent", "plugin"])
  ).default("human_user"),
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
  actorPrincipalType: z.preprocess(
    (value) => (value === "user" ? "human_user" : value),
    z.enum(["human_user", "agent", "plugin"])
  ).default("human_user"),
  tenantId: z.string().min(1).default("tenant-local"),
  workspaceId: z.string().min(1).default("workspace-local"),
  pluginId: z.string().min(1).optional()
});

const gmailGetSchema = z.object({
  actorPrincipalId: z.string().min(1).default("user:local-operator"),
  actorPrincipalType: z.preprocess(
    (value) => (value === "user" ? "human_user" : value),
    z.enum(["human_user", "agent", "plugin"])
  ).default("human_user"),
  tenantId: z.string().min(1).default("tenant-local"),
  workspaceId: z.string().min(1).default("workspace-local"),
  pluginId: z.string().min(1).optional()
});

const gmailRecipientSchema = z.object({
  email: z.string().email(),
  name: z.string().optional()
});

const gmailWriteBaseSchema = z.object({
  actorPrincipalId: z.string().min(1).default("user:local-operator"),
  actorPrincipalType: z.preprocess(
    (value) => (value === "user" ? "human_user" : value),
    z.enum(["human_user", "agent", "plugin"])
  ).default("human_user"),
  tenantId: z.string().min(1).default("tenant-local"),
  workspaceId: z.string().min(1).default("workspace-local"),
  pluginId: z.string().min(1).optional()
});

const gmailCreateDraftSchema = gmailWriteBaseSchema.extend({
  to: z.array(gmailRecipientSchema).min(1),
  subject: z.string().min(1).max(998),
  body: z.string(),
  cc: z.array(gmailRecipientSchema).optional(),
  bcc: z.array(gmailRecipientSchema).optional(),
  contentType: z.enum(["text/plain", "text/html"]).optional()
});

const gmailReplyDraftSchema = gmailWriteBaseSchema.extend({
  threadId: z.string().min(1),
  inReplyToMessageId: z.string().min(1),
  inReplyToMessageIdHeader: z.string().min(1),
  to: z.array(gmailRecipientSchema).min(1),
  subject: z.string().min(1).max(998),
  body: z.string(),
  cc: z.array(gmailRecipientSchema).optional(),
  contentType: z.enum(["text/plain", "text/html"]).optional()
});

const gmailSendSchema = gmailWriteBaseSchema.extend({
  to: z.array(gmailRecipientSchema).min(1),
  subject: z.string().min(1).max(998),
  body: z.string(),
  cc: z.array(gmailRecipientSchema).optional(),
  bcc: z.array(gmailRecipientSchema).optional(),
  contentType: z.enum(["text/plain", "text/html"]).optional(),
  threadId: z.string().optional(),
  inReplyToMessageIdHeader: z.string().optional()
});

const gmailArchiveSchema = gmailWriteBaseSchema;

const gmailLabelSchema = gmailWriteBaseSchema.extend({
  addLabelIds: z.array(z.string().min(1)).optional(),
  removeLabelIds: z.array(z.string().min(1)).optional()
}).refine(
  (data) => (data.addLabelIds?.length ?? 0) + (data.removeLabelIds?.length ?? 0) > 0,
  { message: "At least one of addLabelIds or removeLabelIds must be non-empty" }
);

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
  const gmailWrite = new GmailWriteConnector(new FetchGmailApiClient());

  // Maps Zod-parsed recipients (name?: string | undefined) to GmailRecipient (exactOptionalPropertyTypes)
  const toGmailRecipients = (list: Array<{ email: string; name?: string | undefined }>): GmailRecipient[] =>
    list.map((r) => r.name !== undefined ? { email: r.email, name: r.name } : { email: r.email });

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
        let account = await accountStore.getByProvider("google");
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
        const tokenExpired =
          typeof account.tokenExpiresAt === "string" &&
          Number.isFinite(Date.parse(account.tokenExpiresAt)) &&
          Date.parse(account.tokenExpiresAt) <= Date.now();
        if (tokenExpired && account.refreshTokenReference) {
          try {
            account = await oauth.refreshGoogle(account);
          } catch (error) {
            await accountStore.setStatus(account.accountId, "refresh_failed", error instanceof Error ? error.message : "unknown");
          }
        }
        if (!account.tokenReference) {
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
        const refreshMatched = message.match(/OAuth token refresh failed \((\d+)\)/);
        if (refreshMatched) {
          respondJson(res, 401, {
            schemaVersion: CONTRACT_SCHEMA_VERSION,
            providerId: "google",
            connector: "gmail-read",
            error: {
              code: "GOOGLE_REAUTH_REQUIRED",
              message,
              upstreamStatus: Number(refreshMatched[1]),
              remediation: "Reconnect Google integration to refresh tokens."
            }
          });
          return true;
        }
        const matched = message.match(/Gmail API read failed \((\d+)\)/);
        if (!matched) return false;
        const upstreamStatus = Number(matched[1]);
        const isAuthz = upstreamStatus === 401 || upstreamStatus === 403;
        respondJson(res, isAuthz ? 403 : 502, {
          schemaVersion: CONTRACT_SCHEMA_VERSION,
          providerId: "google",
          connector: "gmail-read",
          error: {
            code: isAuthz ? "GMAIL_AUTHORIZATION_FAILED" : "GMAIL_UPSTREAM_ERROR",
            message,
            upstreamStatus
          }
        });
        return true;
      };

      const runGmailReadWithRefreshRetry = async <T>(input: {
        gate: { account: NonNullable<Awaited<ReturnType<typeof accountStore.getByProvider>>>; accessToken: string };
        op: (accessToken: string) => Promise<T>;
      }): Promise<T> => {
        try {
          return await input.op(input.gate.accessToken);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const matched = message.match(/Gmail API read failed \((\d+)\)/);
          const status = matched ? Number(matched[1]) : NaN;
          const canRetry = (status === 401 || status === 403) && Boolean(input.gate.account.refreshTokenReference);
          if (!canRetry) throw error;

          const refreshed = await oauth.refreshGoogle(input.gate.account);
          if (!refreshed.tokenReference) throw error;
          const refreshedToken = await tokenVault.get(refreshed.tokenReference);
          if (!refreshedToken?.accessToken) throw error;
          return input.op(refreshedToken.accessToken);
        }
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
          result = await runGmailReadWithRefreshRetry({
            gate,
            op: (accessToken) => gmail.listMessages(accessToken, gmailQuery)
          });
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
          result = await runGmailReadWithRefreshRetry({
            gate,
            op: (accessToken) => gmail.searchMessages(accessToken, gmailQuery)
          });
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
          result = await runGmailReadWithRefreshRetry({
            gate,
            op: (accessToken) => gmail.listThreads(accessToken, gmailQuery)
          });
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
          message = await runGmailReadWithRefreshRetry({
            gate,
            op: (accessToken) => gmail.getMessage(accessToken, messageId, gate.account)
          });
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
          thread = await runGmailReadWithRefreshRetry({
            gate,
            op: (accessToken) => gmail.getThread(accessToken, threadId, gate.account)
          });
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

      // ── Gmail write helpers ──────────────────────────────────────────────────

      const runGmailWritePermission = async (
        input: { actorPrincipalId: string; actorPrincipalType: "human_user" | "agent" | "plugin"; tenantId: string; workspaceId: string; pluginId?: string | undefined },
        actionId: "gmail.draft.create" | "gmail.draft.reply" | "gmail.message.send" | "gmail.message.archive" | "gmail.message.label"
      ) => {
        let account = await accountStore.getByProvider("google");
        const actor = {
          principalId: input.actorPrincipalId,
          principalType: input.actorPrincipalType,
          tenantId: input.tenantId,
          workspaceId: input.workspaceId
        } as const;
        const caller = input.pluginId
          ? ({ principalId: input.pluginId, principalType: "plugin", tenantId: input.tenantId, workspaceId: input.workspaceId } as const)
          : ({ principalId: "service:api-gateway", principalType: "service", tenantId: input.tenantId, workspaceId: input.workspaceId } as const);
        const principalContext = { caller, actor, tenantId: input.tenantId, workspaceId: input.workspaceId, scopes: [] as string[], authnStrength: "strong" as const, authenticated: true };
        const permissionInput: Parameters<typeof checkGoogleActionPermission>[0] = {
          account, actionId, principalContext, actor, caller,
          tenantId: input.tenantId, workspaceId: input.workspaceId,
          trace: { traceId: trace.traceId, correlationId: trace.correlationId },
          policyClient
        };
        if (input.pluginId) permissionInput.pluginId = input.pluginId;

        const permission = await checkGoogleActionPermission(permissionInput);
        const auditInput: Parameters<typeof buildGooglePermissionAuditEvent>[0] = {
          traceId: trace.traceId, correlationId: trace.correlationId,
          actor, caller, tenantId: input.tenantId, workspaceId: input.workspaceId,
          ...(account?.accountId ? { accountId: account.accountId } : {}),
          ...(input.pluginId ? { pluginId: input.pluginId } : {}),
          result: permission
        };
        audit.emit(buildGooglePermissionAuditEvent(auditInput));

        if (permission.decision === "deny") {
          respondJson(res, 403, { schemaVersion: CONTRACT_SCHEMA_VERSION, providerId: "google", connector: "gmail-write", permission });
          return { allowed: false as const, account: null };
        }
        if (permission.decision === "require_approval") {
          respondJson(res, 202, {
            schemaVersion: CONTRACT_SCHEMA_VERSION,
            providerId: "google",
            connector: "gmail-write",
            permission,
            approvalRequired: true,
            approvalReason: permission.reasonCodes
          });
          return { allowed: false as const, account: null };
        }
        if (!account?.tokenReference) {
          respondJson(res, 400, { schemaVersion: CONTRACT_SCHEMA_VERSION, error: "Google integration token reference missing" });
          return { allowed: false as const, account: null };
        }
        const tokenExpired =
          typeof account.tokenExpiresAt === "string" &&
          Number.isFinite(Date.parse(account.tokenExpiresAt)) &&
          Date.parse(account.tokenExpiresAt) <= Date.now();
        if (tokenExpired && account.refreshTokenReference) {
          try { account = await oauth.refreshGoogle(account); }
          catch (error) { await accountStore.setStatus(account.accountId, "refresh_failed", error instanceof Error ? error.message : "unknown"); }
        }
        if (!account.tokenReference) {
          respondJson(res, 400, { schemaVersion: CONTRACT_SCHEMA_VERSION, error: "Google integration token reference missing" });
          return { allowed: false as const, account: null };
        }
        const token = await tokenVault.get(account.tokenReference);
        if (!token?.accessToken) {
          respondJson(res, 400, { schemaVersion: CONTRACT_SCHEMA_VERSION, error: "Google access token not available" });
          return { allowed: false as const, account: null };
        }
        return { allowed: true as const, account, accessToken: token.accessToken };
      };

      const handleGmailWriteUpstreamError = (error: unknown): boolean => {
        const message = error instanceof Error ? error.message : "unknown";
        const refreshMatched = message.match(/OAuth token refresh failed \((\d+)\)/);
        if (refreshMatched) {
          respondJson(res, 401, {
            schemaVersion: CONTRACT_SCHEMA_VERSION, providerId: "google", connector: "gmail-write",
            error: { code: "GOOGLE_REAUTH_REQUIRED", message, upstreamStatus: Number(refreshMatched[1]), remediation: "Reconnect Google integration with write scopes." }
          });
          return true;
        }
        const matched = message.match(/Gmail API write failed \((\d+)\)/);
        if (!matched) return false;
        const upstreamStatus = Number(matched[1]);
        const isAuthz = upstreamStatus === 401 || upstreamStatus === 403;
        respondJson(res, isAuthz ? 403 : 502, {
          schemaVersion: CONTRACT_SCHEMA_VERSION, providerId: "google", connector: "gmail-write",
          error: { code: isAuthz ? "GMAIL_WRITE_AUTHORIZATION_FAILED" : "GMAIL_WRITE_UPSTREAM_ERROR", message, upstreamStatus }
        });
        return true;
      };

      // ── POST /integrations/google/gmail/drafts/create ────────────────────────
      if (req.method === "POST" && reqUrl.pathname === "/integrations/google/gmail/drafts/create") {
        const input = gmailCreateDraftSchema.parse(await readJsonBody(req));
        const gate = await runGmailWritePermission(input, "gmail.draft.create");
        if (!gate.allowed) return true;
        audit.emit({
          producingService: "api-gateway", eventType: "tool.invoked", severity: "info",
          traceId: trace.traceId, correlationId: trace.correlationId,
          reasonCodes: ["gmail_draft_create_requested"],
          payload: {
            providerId: "google", actionId: "gmail.draft.create",
            recipientCount: input.to.length, subjectLength: input.subject.length,
            hasCc: (input.cc?.length ?? 0) > 0, hasBcc: (input.bcc?.length ?? 0) > 0
          }
        });
        let result;
        try {
          result = await gmailWrite.createDraft(gate.accessToken, {
            to: toGmailRecipients(input.to), subject: input.subject, body: input.body,
            ...(input.cc ? { cc: toGmailRecipients(input.cc) } : {}),
            ...(input.bcc ? { bcc: toGmailRecipients(input.bcc) } : {}),
            ...(input.contentType ? { contentType: input.contentType } : {})
          }, gate.account);
        } catch (error) {
          audit.emit({ producingService: "api-gateway", eventType: "tool.failed", severity: "warn", traceId: trace.traceId, correlationId: trace.correlationId, reasonCodes: ["gmail_draft_create_failed"], payload: { providerId: "google", error: error instanceof Error ? error.message.slice(0, 200) : "unknown" } });
          if (handleGmailWriteUpstreamError(error)) return true;
          throw error;
        }
        audit.emit({
          producingService: "api-gateway", eventType: "tool.completed", severity: "info",
          traceId: trace.traceId, correlationId: trace.correlationId,
          reasonCodes: ["gmail_draft_create_completed"],
          resource: { resourceClass: "integration-account", resourceId: gate.account.accountId },
          payload: { providerId: "google", actionId: "gmail.draft.create", draftId: result.draftId, threadId: result.threadId }
        });
        respondJson(res, 201, { schemaVersion: CONTRACT_SCHEMA_VERSION, providerId: "google", connector: "gmail-write", result });
        return true;
      }

      // ── POST /integrations/google/gmail/drafts/reply ─────────────────────────
      if (req.method === "POST" && reqUrl.pathname === "/integrations/google/gmail/drafts/reply") {
        const input = gmailReplyDraftSchema.parse(await readJsonBody(req));
        const gate = await runGmailWritePermission(input, "gmail.draft.reply");
        if (!gate.allowed) return true;
        audit.emit({
          producingService: "api-gateway", eventType: "tool.invoked", severity: "info",
          traceId: trace.traceId, correlationId: trace.correlationId,
          reasonCodes: ["gmail_reply_draft_create_requested"],
          payload: {
            providerId: "google", actionId: "gmail.draft.reply",
            threadId: input.threadId, inReplyToMessageId: input.inReplyToMessageId,
            recipientCount: input.to.length
          }
        });
        let result;
        try {
          result = await gmailWrite.createReplyDraft(gate.accessToken, {
            threadId: input.threadId,
            inReplyToMessageId: input.inReplyToMessageId,
            inReplyToMessageIdHeader: input.inReplyToMessageIdHeader,
            to: toGmailRecipients(input.to), subject: input.subject, body: input.body,
            ...(input.cc ? { cc: toGmailRecipients(input.cc) } : {}),
            ...(input.contentType ? { contentType: input.contentType } : {})
          }, gate.account);
        } catch (error) {
          audit.emit({ producingService: "api-gateway", eventType: "tool.failed", severity: "warn", traceId: trace.traceId, correlationId: trace.correlationId, reasonCodes: ["gmail_reply_draft_create_failed"], payload: { providerId: "google", error: error instanceof Error ? error.message.slice(0, 200) : "unknown" } });
          if (handleGmailWriteUpstreamError(error)) return true;
          throw error;
        }
        audit.emit({
          producingService: "api-gateway", eventType: "tool.completed", severity: "info",
          traceId: trace.traceId, correlationId: trace.correlationId,
          reasonCodes: ["gmail_reply_draft_create_completed"],
          resource: { resourceClass: "integration-account", resourceId: gate.account.accountId },
          payload: { providerId: "google", actionId: "gmail.draft.reply", draftId: result.draftId, threadId: result.threadId }
        });
        respondJson(res, 201, { schemaVersion: CONTRACT_SCHEMA_VERSION, providerId: "google", connector: "gmail-write", result });
        return true;
      }

      // ── POST /integrations/google/gmail/messages/send ────────────────────────
      if (req.method === "POST" && reqUrl.pathname === "/integrations/google/gmail/messages/send") {
        const input = gmailSendSchema.parse(await readJsonBody(req));
        // gmail.message.send always returns require_approval — gate enforces it
        const gate = await runGmailWritePermission(input, "gmail.message.send");
        if (!gate.allowed) return true;
        audit.emit({
          producingService: "api-gateway", eventType: "tool.invoked", severity: "info",
          traceId: trace.traceId, correlationId: trace.correlationId,
          reasonCodes: ["gmail_send_requested"],
          payload: {
            providerId: "google", actionId: "gmail.message.send",
            recipientCount: input.to.length, subjectLength: input.subject.length,
            hasCc: (input.cc?.length ?? 0) > 0, hasBcc: (input.bcc?.length ?? 0) > 0,
            hasThreadId: Boolean(input.threadId)
          }
        });
        let result;
        try {
          result = await gmailWrite.sendMessage(gate.accessToken, {
            to: toGmailRecipients(input.to), subject: input.subject, body: input.body,
            ...(input.cc ? { cc: toGmailRecipients(input.cc) } : {}),
            ...(input.bcc ? { bcc: toGmailRecipients(input.bcc) } : {}),
            ...(input.contentType ? { contentType: input.contentType } : {}),
            ...(input.threadId ? { threadId: input.threadId } : {}),
            ...(input.inReplyToMessageIdHeader ? { inReplyToMessageIdHeader: input.inReplyToMessageIdHeader } : {})
          }, gate.account);
        } catch (error) {
          audit.emit({ producingService: "api-gateway", eventType: "tool.failed", severity: "high", traceId: trace.traceId, correlationId: trace.correlationId, reasonCodes: ["gmail_send_failed"], payload: { providerId: "google", error: error instanceof Error ? error.message.slice(0, 200) : "unknown" } });
          if (handleGmailWriteUpstreamError(error)) return true;
          throw error;
        }
        audit.emit({
          producingService: "api-gateway", eventType: "tool.completed", severity: "info",
          traceId: trace.traceId, correlationId: trace.correlationId,
          reasonCodes: ["gmail_send_completed"],
          resource: { resourceClass: "integration-account", resourceId: gate.account.accountId },
          payload: { providerId: "google", actionId: "gmail.message.send", messageId: result.messageId, threadId: result.threadId }
        });
        respondJson(res, 200, { schemaVersion: CONTRACT_SCHEMA_VERSION, providerId: "google", connector: "gmail-write", result });
        return true;
      }

      // ── POST /integrations/google/gmail/messages/:messageId/archive ──────────
      const isGmailArchive = req.method === "POST" && /^\/integrations\/google\/gmail\/messages\/[^/]+\/archive$/.test(reqUrl.pathname);
      if (isGmailArchive) {
        const messageId = decodeURIComponent(reqUrl.pathname.split("/").slice(-2, -1)[0] ?? "");
        if (!messageId) { respondJson(res, 400, { schemaVersion: CONTRACT_SCHEMA_VERSION, error: "Missing messageId" }); return true; }
        const input = gmailArchiveSchema.parse(await readJsonBody(req));
        const gate = await runGmailWritePermission(input, "gmail.message.archive");
        if (!gate.allowed) return true;
        audit.emit({
          producingService: "api-gateway", eventType: "tool.invoked", severity: "info",
          traceId: trace.traceId, correlationId: trace.correlationId,
          reasonCodes: ["gmail_archive_requested"],
          payload: { providerId: "google", actionId: "gmail.message.archive", messageId }
        });
        let result;
        try {
          result = await gmailWrite.archiveMessage(gate.accessToken, messageId);
        } catch (error) {
          audit.emit({ producingService: "api-gateway", eventType: "tool.failed", severity: "warn", traceId: trace.traceId, correlationId: trace.correlationId, reasonCodes: ["gmail_archive_failed"], payload: { providerId: "google", error: error instanceof Error ? error.message.slice(0, 200) : "unknown" } });
          if (handleGmailWriteUpstreamError(error)) return true;
          throw error;
        }
        audit.emit({
          producingService: "api-gateway", eventType: "tool.completed", severity: "info",
          traceId: trace.traceId, correlationId: trace.correlationId,
          reasonCodes: ["gmail_archive_completed"],
          resource: { resourceClass: "integration-account", resourceId: gate.account.accountId },
          payload: { providerId: "google", actionId: "gmail.message.archive", messageId: result.messageId }
        });
        respondJson(res, 200, { schemaVersion: CONTRACT_SCHEMA_VERSION, providerId: "google", connector: "gmail-write", result });
        return true;
      }

      // ── POST /integrations/google/gmail/messages/:messageId/labels ───────────
      const isGmailLabel = req.method === "POST" && /^\/integrations\/google\/gmail\/messages\/[^/]+\/labels$/.test(reqUrl.pathname);
      if (isGmailLabel) {
        const messageId = decodeURIComponent(reqUrl.pathname.split("/").slice(-2, -1)[0] ?? "");
        if (!messageId) { respondJson(res, 400, { schemaVersion: CONTRACT_SCHEMA_VERSION, error: "Missing messageId" }); return true; }
        const input = gmailLabelSchema.parse(await readJsonBody(req));
        const gate = await runGmailWritePermission(input, "gmail.message.label");
        if (!gate.allowed) return true;
        audit.emit({
          producingService: "api-gateway", eventType: "tool.invoked", severity: "info",
          traceId: trace.traceId, correlationId: trace.correlationId,
          reasonCodes: ["gmail_label_requested"],
          payload: {
            providerId: "google", actionId: "gmail.message.label", messageId,
            addLabelIds: input.addLabelIds ?? [], removeLabelIds: input.removeLabelIds ?? []
          }
        });
        let result;
        try {
          result = await gmailWrite.modifyLabels(gate.accessToken, messageId, {
            ...(input.addLabelIds ? { addLabelIds: input.addLabelIds } : {}),
            ...(input.removeLabelIds ? { removeLabelIds: input.removeLabelIds } : {})
          });
        } catch (error) {
          audit.emit({ producingService: "api-gateway", eventType: "tool.failed", severity: "warn", traceId: trace.traceId, correlationId: trace.correlationId, reasonCodes: ["gmail_label_failed"], payload: { providerId: "google", error: error instanceof Error ? error.message.slice(0, 200) : "unknown" } });
          if (handleGmailWriteUpstreamError(error)) return true;
          throw error;
        }
        audit.emit({
          producingService: "api-gateway", eventType: "tool.completed", severity: "info",
          traceId: trace.traceId, correlationId: trace.correlationId,
          reasonCodes: ["gmail_label_completed"],
          resource: { resourceClass: "integration-account", resourceId: gate.account.accountId },
          payload: { providerId: "google", actionId: "gmail.message.label", messageId: result.messageId, addedLabels: result.addedLabels, removedLabels: result.removedLabels }
        });
        respondJson(res, 200, { schemaVersion: CONTRACT_SCHEMA_VERSION, providerId: "google", connector: "gmail-write", result });
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
