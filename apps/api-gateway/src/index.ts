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
  FetchCalendarApiClient,
  GOOGLE_PROVIDER_PROFILE,
  GmailReadConnector,
  GmailWriteConnector,
  CalendarReadConnector,
  CalendarWriteConnector,
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
    "calendar.event.create",
    "calendar.event.create_with_attendees",
    "calendar.event.update",
    "calendar.event.update_attendees",
    "calendar.event.delete",
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
  approvalState: z.enum(["approved", "not_required"]).optional(),
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

const calendarReadBaseSchema = z.object({
  actorPrincipalId: z.string().min(1).default("user:local-operator"),
  actorPrincipalType: z.preprocess(
    (value) => (value === "user" ? "human_user" : value),
    z.enum(["human_user", "agent", "plugin"])
  ).default("human_user"),
  tenantId: z.string().min(1).default("tenant-local"),
  workspaceId: z.string().min(1).default("workspace-local"),
  pluginId: z.string().min(1).optional()
});

const calendarListEventsSchema = calendarReadBaseSchema.extend({
  calendarId: z.string().min(1).default("primary"),
  timeMin: z.string().optional(),
  timeMax: z.string().optional(),
  maxResults: z.number().int().positive().max(100).default(25),
  pageToken: z.string().optional(),
  singleEvents: z.boolean().default(true),
  orderBy: z.enum(["startTime", "updated"]).default("startTime"),
  query: z.string().optional(),
  showDeleted: z.boolean().optional()
});

const calendarGetEventSchema = calendarReadBaseSchema.extend({
  calendarId: z.string().min(1).default("primary")
});

const calendarTodaySchema = calendarReadBaseSchema.extend({
  calendarId: z.string().min(1).default("primary"),
  timezone: z.string().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dayOffset: z.number().int().min(-3650).max(3650).optional()
});

const calendarUpcomingSchema = calendarReadBaseSchema.extend({
  calendarId: z.string().min(1).default("primary"),
  maxResults: z.number().int().positive().max(50).default(10)
});

const calendarAvailabilitySchema = calendarReadBaseSchema.extend({
  calendarId: z.string().min(1).default("primary"),
  timeMin: z.string().min(1),
  timeMax: z.string().min(1),
  checkTimeIso: z.string().optional()
});

const calendarWriteBaseSchema = z.object({
  actorPrincipalId: z.string().min(1).default("user:local-operator"),
  actorPrincipalType: z.preprocess(
    (value) => (value === "user" ? "human_user" : value),
    z.enum(["human_user", "agent", "plugin"])
  ).default("human_user"),
  tenantId: z.string().min(1).default("tenant-local"),
  workspaceId: z.string().min(1).default("workspace-local"),
  approvalState: z.enum(["approved", "not_required"]).optional(),
  pluginId: z.string().min(1).optional()
});

const calendarAttendeeSchema = z.object({
  email: z.string().email(),
  displayName: z.string().optional()
});

const calendarReminderSchema = z.object({
  useDefault: z.boolean().optional(),
  overrides: z.array(z.object({
    method: z.enum(["email", "popup"]),
    minutes: z.number().int().nonnegative()
  })).optional()
});

const calendarCreateEventSchema = calendarWriteBaseSchema.extend({
  calendarId: z.string().min(1).default("primary"),
  summary: z.string().min(1).max(500),
  startDateTime: z.string().min(1),
  endDateTime: z.string().min(1),
  timeZone: z.string().optional(),
  description: z.string().max(8000).optional(),
  location: z.string().max(500).optional(),
  attendees: z.array(calendarAttendeeSchema).optional(),
  reminders: calendarReminderSchema.optional(),
  visibility: z.enum(["default", "public", "private", "confidential"]).optional(),
  guestsCanModify: z.boolean().optional(),
  guestsCanInviteOthers: z.boolean().optional(),
  sendNotifications: z.boolean().optional()
});

const calendarUpdateEventSchema = calendarWriteBaseSchema.extend({
  calendarId: z.string().min(1).default("primary"),
  eventId: z.string().min(1),
  summary: z.string().min(1).max(500).optional(),
  description: z.string().max(8000).optional(),
  location: z.string().max(500).optional(),
  startDateTime: z.string().optional(),
  endDateTime: z.string().optional(),
  timeZone: z.string().optional(),
  attendeesToAdd: z.array(calendarAttendeeSchema).optional(),
  attendeesToRemove: z.array(z.string().email()).optional(),
  reminders: calendarReminderSchema.optional(),
  visibility: z.enum(["default", "public", "private", "confidential"]).optional(),
  sendNotifications: z.boolean().optional()
});

const calendarDeleteEventSchema = calendarWriteBaseSchema.extend({
  calendarId: z.string().min(1).default("primary"),
  eventId: z.string().min(1),
  sendNotifications: z.boolean().optional()
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
  const gmailWrite = new GmailWriteConnector(new FetchGmailApiClient());
  const calendar = new CalendarReadConnector(new FetchCalendarApiClient());
  const calendarWrite = new CalendarWriteConnector(new FetchCalendarApiClient());

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
        input: { actorPrincipalId: string; actorPrincipalType: "human_user" | "agent" | "plugin"; tenantId: string; workspaceId: string; approvalState?: "approved" | "not_required" | undefined; pluginId?: string | undefined },
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
          approvalPresent: input.approvalState === "approved",
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
        if (permission.decision === "require_approval" && input.approvalState !== "approved") {
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
        let accessToken = gate.accessToken;
        let account = gate.account;
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
          result = await gmailWrite.sendMessage(accessToken, {
            to: toGmailRecipients(input.to), subject: input.subject, body: input.body,
            ...(input.cc ? { cc: toGmailRecipients(input.cc) } : {}),
            ...(input.bcc ? { bcc: toGmailRecipients(input.bcc) } : {}),
            ...(input.contentType ? { contentType: input.contentType } : {}),
            ...(input.threadId ? { threadId: input.threadId } : {}),
            ...(input.inReplyToMessageIdHeader ? { inReplyToMessageIdHeader: input.inReplyToMessageIdHeader } : {})
          }, account);
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : "unknown";
          const isAuthnFailure = /Gmail API write failed \(401\)/.test(errorMessage);
          if (isAuthnFailure && account.refreshTokenReference) {
            try {
              account = await oauth.refreshGoogle(account);
              if (!account.tokenReference) {
                throw error;
              }
              const refreshed = await tokenVault.get(account.tokenReference);
              if (refreshed?.accessToken) {
                accessToken = refreshed.accessToken;
                result = await gmailWrite.sendMessage(accessToken, {
                  to: toGmailRecipients(input.to), subject: input.subject, body: input.body,
                  ...(input.cc ? { cc: toGmailRecipients(input.cc) } : {}),
                  ...(input.bcc ? { bcc: toGmailRecipients(input.bcc) } : {}),
                  ...(input.contentType ? { contentType: input.contentType } : {}),
                  ...(input.threadId ? { threadId: input.threadId } : {}),
                  ...(input.inReplyToMessageIdHeader ? { inReplyToMessageIdHeader: input.inReplyToMessageIdHeader } : {})
                }, account);
              } else {
                throw error;
              }
            } catch {
              audit.emit({ producingService: "api-gateway", eventType: "tool.failed", severity: "high", traceId: trace.traceId, correlationId: trace.correlationId, reasonCodes: ["gmail_send_failed"], payload: { providerId: "google", error: errorMessage.slice(0, 200) } });
              if (handleGmailWriteUpstreamError(error)) return true;
              throw error;
            }
          } else {
          audit.emit({ producingService: "api-gateway", eventType: "tool.failed", severity: "high", traceId: trace.traceId, correlationId: trace.correlationId, reasonCodes: ["gmail_send_failed"], payload: { providerId: "google", error: error instanceof Error ? error.message.slice(0, 200) : "unknown" } });
          if (handleGmailWriteUpstreamError(error)) return true;
          throw error;
          }
        }
        audit.emit({
          producingService: "api-gateway", eventType: "tool.completed", severity: "info",
          traceId: trace.traceId, correlationId: trace.correlationId,
          reasonCodes: ["gmail_send_completed"],
          resource: { resourceClass: "integration-account", resourceId: account.accountId },
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

      // ── Google Calendar read endpoints ────────────────────────────────────────

      if (req.method === "GET" && reqUrl.pathname === "/integrations/google/calendar/health") {
        const account = await accountStore.getByProvider("google");
        let tokenPresent = false;
        if (account?.tokenReference) {
          const token = await tokenVault.get(account.tokenReference);
          tokenPresent = Boolean(token?.accessToken);
        }
        audit.emit({
          producingService: "api-gateway",
          eventType: "tool.invoked",
          severity: "info",
          traceId: trace.traceId,
          correlationId: trace.correlationId,
          reasonCodes: ["calendar_health_requested"],
          payload: { providerId: "google", connector: "calendar-read" }
        });
        respondJson(res, 200, {
          schemaVersion: CONTRACT_SCHEMA_VERSION,
          providerId: "google",
          connector: "calendar-read",
          health: calendar.computeHealth(account, tokenPresent)
        });
        return true;
      }

      const runCalendarReadPermission = async (
        input: { actorPrincipalId: string; actorPrincipalType: "human_user" | "agent" | "plugin"; tenantId: string; workspaceId: string; pluginId?: string | undefined }
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
        const principalContext = {
          caller, actor,
          tenantId: input.tenantId, workspaceId: input.workspaceId,
          scopes: [] as string[], authnStrength: "strong" as const, authenticated: true
        };
        const permissionInput: Parameters<typeof checkGoogleActionPermission>[0] = {
          account,
          actionId: "calendar.events.read",
          principalContext, actor, caller,
          tenantId: input.tenantId, workspaceId: input.workspaceId,
          trace: { traceId: trace.traceId, correlationId: trace.correlationId },
          policyClient
        };
        if (input.pluginId) permissionInput.pluginId = input.pluginId;

        const permission = await checkGoogleActionPermission(permissionInput);
        audit.emit(buildGooglePermissionAuditEvent({
          traceId: trace.traceId, correlationId: trace.correlationId,
          actor, caller,
          tenantId: input.tenantId, workspaceId: input.workspaceId,
          ...(account?.accountId ? { accountId: account.accountId } : {}),
          ...(input.pluginId ? { pluginId: input.pluginId } : {}),
          result: permission
        }));

        if (permission.decision === "deny") {
          respondJson(res, 403, { schemaVersion: CONTRACT_SCHEMA_VERSION, providerId: "google", connector: "calendar-read", permission });
          return { allowed: false as const, account: null };
        }
        if (permission.decision === "require_approval") {
          respondJson(res, 202, { schemaVersion: CONTRACT_SCHEMA_VERSION, providerId: "google", connector: "calendar-read", permission });
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

      const handleCalendarUpstreamError = (error: unknown): boolean => {
        const message = error instanceof Error ? error.message : "unknown";
        const refreshMatched = message.match(/OAuth token refresh failed \((\d+)\)/);
        if (refreshMatched) {
          respondJson(res, 401, {
            schemaVersion: CONTRACT_SCHEMA_VERSION, providerId: "google", connector: "calendar-read",
            error: { code: "GOOGLE_REAUTH_REQUIRED", message, upstreamStatus: Number(refreshMatched[1]), remediation: "Reconnect Google integration to refresh tokens." }
          });
          return true;
        }
        const matched = message.match(/Calendar API (?:read|request) failed \((\d+)\)/);
        if (!matched) return false;
        const upstreamStatus = Number(matched[1]);
        const isAuthz = upstreamStatus === 401 || upstreamStatus === 403;
        respondJson(res, isAuthz ? 403 : 502, {
          schemaVersion: CONTRACT_SCHEMA_VERSION, providerId: "google", connector: "calendar-read",
          error: { code: isAuthz ? "CALENDAR_AUTHORIZATION_FAILED" : "CALENDAR_UPSTREAM_ERROR", message, upstreamStatus }
        });
        return true;
      };

      // GET /integrations/google/calendar/calendars
      if (req.method === "GET" && reqUrl.pathname === "/integrations/google/calendar/calendars") {
        const parsed = calendarReadBaseSchema.parse({
          actorPrincipalId: reqUrl.searchParams.get("actorPrincipalId") ?? undefined,
          actorPrincipalType: reqUrl.searchParams.get("actorPrincipalType") ?? undefined,
          tenantId: reqUrl.searchParams.get("tenantId") ?? undefined,
          workspaceId: reqUrl.searchParams.get("workspaceId") ?? undefined,
          pluginId: reqUrl.searchParams.get("pluginId") ?? undefined
        });
        const gate = await runCalendarReadPermission(parsed);
        if (!gate.allowed) return true;
        const pageToken = reqUrl.searchParams.get("pageToken") ?? undefined;
        audit.emit({
          producingService: "api-gateway", eventType: "tool.invoked", severity: "info",
          traceId: trace.traceId, correlationId: trace.correlationId,
          reasonCodes: ["calendar_list_requested"],
          payload: { providerId: "google", connector: "calendar-read", action: "list_calendars" }
        });
        let result;
        try {
          result = await calendar.listCalendars(gate.accessToken, gate.account, pageToken);
        } catch (error) {
          if (handleCalendarUpstreamError(error)) return true;
          throw error;
        }
        audit.emit({
          producingService: "api-gateway", eventType: "tool.completed", severity: "info",
          traceId: trace.traceId, correlationId: trace.correlationId,
          reasonCodes: ["calendar_list_completed"],
          payload: { providerId: "google", count: result.calendars.length }
        });
        respondJson(res, 200, { schemaVersion: CONTRACT_SCHEMA_VERSION, providerId: "google", connector: "calendar-read", result });
        return true;
      }

      // POST /integrations/google/calendar/events/list
      if (req.method === "POST" && reqUrl.pathname === "/integrations/google/calendar/events/list") {
        const input = calendarListEventsSchema.parse(await readJsonBody(req));
        const gate = await runCalendarReadPermission(input);
        if (!gate.allowed) return true;
        audit.emit({
          producingService: "api-gateway", eventType: "tool.invoked", severity: "info",
          traceId: trace.traceId, correlationId: trace.correlationId,
          reasonCodes: ["calendar_events_list_requested"],
          payload: { providerId: "google", calendarId: input.calendarId, timeMin: input.timeMin ?? null, timeMax: input.timeMax ?? null }
        });
        let result;
        try {
          result = await calendar.listEvents(gate.accessToken, gate.account, {
            calendarId: input.calendarId,
            ...(input.timeMin ? { timeMin: input.timeMin } : {}),
            ...(input.timeMax ? { timeMax: input.timeMax } : {}),
            maxResults: input.maxResults,
            ...(input.pageToken ? { pageToken: input.pageToken } : {}),
            singleEvents: input.singleEvents,
            orderBy: input.orderBy,
            ...(input.query ? { query: input.query } : {}),
            ...(input.showDeleted ? { showDeleted: input.showDeleted } : {})
          });
        } catch (error) {
          if (handleCalendarUpstreamError(error)) return true;
          throw error;
        }
        audit.emit({
          producingService: "api-gateway", eventType: "tool.completed", severity: "info",
          traceId: trace.traceId, correlationId: trace.correlationId,
          reasonCodes: ["calendar_events_list_completed"],
          payload: { providerId: "google", calendarId: input.calendarId, count: result.events.length }
        });
        respondJson(res, 200, { schemaVersion: CONTRACT_SCHEMA_VERSION, providerId: "google", connector: "calendar-read", result });
        return true;
      }

      // POST /integrations/google/calendar/events/today
      if (req.method === "POST" && reqUrl.pathname === "/integrations/google/calendar/events/today") {
        const input = calendarTodaySchema.parse(await readJsonBody(req));
        const gate = await runCalendarReadPermission(input);
        if (!gate.allowed) return true;
        audit.emit({
          producingService: "api-gateway", eventType: "tool.invoked", severity: "info",
          traceId: trace.traceId, correlationId: trace.correlationId,
          reasonCodes: ["calendar_today_requested"],
          payload: {
            providerId: "google",
            calendarId: input.calendarId,
            timezone: input.timezone ?? "local",
            date: input.date ?? null,
            dayOffset: input.dayOffset ?? 0
          }
        });
        let result;
        try {
          result = await calendar.getTodayEvents(
            gate.accessToken,
            gate.account,
            input.calendarId,
            input.timezone,
            input.date,
            input.dayOffset
          );
        } catch (error) {
          if (handleCalendarUpstreamError(error)) return true;
          throw error;
        }
        audit.emit({
          producingService: "api-gateway", eventType: "tool.completed", severity: "info",
          traceId: trace.traceId, correlationId: trace.correlationId,
          reasonCodes: ["calendar_today_completed"],
          payload: { providerId: "google", calendarId: input.calendarId, count: result.events.length }
        });
        respondJson(res, 200, { schemaVersion: CONTRACT_SCHEMA_VERSION, providerId: "google", connector: "calendar-read", result });
        return true;
      }

      // POST /integrations/google/calendar/events/upcoming
      if (req.method === "POST" && reqUrl.pathname === "/integrations/google/calendar/events/upcoming") {
        const input = calendarUpcomingSchema.parse(await readJsonBody(req));
        const gate = await runCalendarReadPermission(input);
        if (!gate.allowed) return true;
        audit.emit({
          producingService: "api-gateway", eventType: "tool.invoked", severity: "info",
          traceId: trace.traceId, correlationId: trace.correlationId,
          reasonCodes: ["calendar_upcoming_requested"],
          payload: { providerId: "google", calendarId: input.calendarId, maxResults: input.maxResults }
        });
        let result;
        try {
          result = await calendar.getUpcomingEvents(gate.accessToken, gate.account, input.calendarId, input.maxResults);
        } catch (error) {
          if (handleCalendarUpstreamError(error)) return true;
          throw error;
        }
        audit.emit({
          producingService: "api-gateway", eventType: "tool.completed", severity: "info",
          traceId: trace.traceId, correlationId: trace.correlationId,
          reasonCodes: ["calendar_upcoming_completed"],
          payload: { providerId: "google", calendarId: input.calendarId, count: result.events.length }
        });
        respondJson(res, 200, { schemaVersion: CONTRACT_SCHEMA_VERSION, providerId: "google", connector: "calendar-read", result });
        return true;
      }

      // POST /integrations/google/calendar/availability
      if (req.method === "POST" && reqUrl.pathname === "/integrations/google/calendar/availability") {
        const input = calendarAvailabilitySchema.parse(await readJsonBody(req));
        const gate = await runCalendarReadPermission(input);
        if (!gate.allowed) return true;
        audit.emit({
          producingService: "api-gateway", eventType: "tool.invoked", severity: "info",
          traceId: trace.traceId, correlationId: trace.correlationId,
          reasonCodes: ["calendar_availability_requested"],
          payload: { providerId: "google", calendarId: input.calendarId, timeMin: input.timeMin, timeMax: input.timeMax }
        });
        let result;
        try {
          result = await calendar.checkAvailability(
            gate.accessToken, gate.account,
            input.calendarId, input.timeMin, input.timeMax,
            input.checkTimeIso
          );
        } catch (error) {
          if (handleCalendarUpstreamError(error)) return true;
          throw error;
        }
        audit.emit({
          producingService: "api-gateway", eventType: "tool.completed", severity: "info",
          traceId: trace.traceId, correlationId: trace.correlationId,
          reasonCodes: ["calendar_availability_completed"],
          payload: {
            providerId: "google", calendarId: input.calendarId,
            busyBlockCount: result.busyBlocks.length,
            freeSlotCount: result.freeSlots.length,
            totalBusyMinutes: result.totalBusyMinutes
          }
        });
        respondJson(res, 200, { schemaVersion: CONTRACT_SCHEMA_VERSION, providerId: "google", connector: "calendar-read", result });
        return true;
      }

      // GET /integrations/google/calendar/events/:calendarId/:eventId
      const calendarEventGetMatch = req.method === "GET" &&
        /^\/integrations\/google\/calendar\/events\/[^/]+\/[^/]+$/.test(reqUrl.pathname);
      if (calendarEventGetMatch) {
        const parts = reqUrl.pathname.split("/");
        const eventId = decodeURIComponent(parts[parts.length - 1] ?? "");
        const calendarIdRaw = decodeURIComponent(parts[parts.length - 2] ?? "primary");
        const input = calendarGetEventSchema.parse({
          calendarId: calendarIdRaw,
          actorPrincipalId: reqUrl.searchParams.get("actorPrincipalId") ?? undefined,
          actorPrincipalType: reqUrl.searchParams.get("actorPrincipalType") ?? undefined,
          tenantId: reqUrl.searchParams.get("tenantId") ?? undefined,
          workspaceId: reqUrl.searchParams.get("workspaceId") ?? undefined,
          pluginId: reqUrl.searchParams.get("pluginId") ?? undefined
        });
        const gate = await runCalendarReadPermission(input);
        if (!gate.allowed) return true;
        let event;
        try {
          event = await calendar.getEvent(gate.accessToken, gate.account, input.calendarId, eventId);
        } catch (error) {
          if (handleCalendarUpstreamError(error)) return true;
          throw error;
        }
        respondJson(res, 200, {
          schemaVersion: CONTRACT_SCHEMA_VERSION,
          providerId: "google",
          connector: "calendar-read",
          event,
          ingestionRecord: calendar.toIngressRecord(event)
        });
        return true;
      }

      // ── Google Calendar write helpers ─────────────────────────────────────────

      const runCalendarWritePermission = async (
        input: { actorPrincipalId: string; actorPrincipalType: "human_user" | "agent" | "plugin"; tenantId: string; workspaceId: string; approvalState?: "approved" | "not_required" | undefined; pluginId?: string | undefined },
        actionId: "calendar.event.create" | "calendar.event.create_with_attendees" | "calendar.event.update" | "calendar.event.update_attendees" | "calendar.event.delete"
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
          approvalPresent: input.approvalState === "approved",
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
          respondJson(res, 403, { schemaVersion: CONTRACT_SCHEMA_VERSION, providerId: "google", connector: "calendar-write", permission });
          return { allowed: false as const, account: null };
        }
        if (permission.decision === "require_approval" && input.approvalState !== "approved") {
          respondJson(res, 202, {
            schemaVersion: CONTRACT_SCHEMA_VERSION, providerId: "google", connector: "calendar-write",
            permission, approvalRequired: true, approvalReason: permission.reasonCodes,
            approvalReview: {
              actionId,
              serviceFamily: "calendar",
              approvalSensitivity: permission.action.approvalSensitivity,
              requiresExplicitApproval: true
            }
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

      const handleCalendarWriteUpstreamError = (error: unknown): boolean => {
        const message = error instanceof Error ? error.message : "unknown";
        const refreshMatched = message.match(/OAuth token refresh failed \((\d+)\)/);
        if (refreshMatched) {
          respondJson(res, 401, {
            schemaVersion: CONTRACT_SCHEMA_VERSION, providerId: "google", connector: "calendar-write",
            error: { code: "GOOGLE_REAUTH_REQUIRED", message, upstreamStatus: Number(refreshMatched[1]), remediation: "Reconnect Google integration with calendar write scope." }
          });
          return true;
        }
        const matched = message.match(/Calendar API write failed \((\d+)\)/);
        if (!matched) return false;
        const upstreamStatus = Number(matched[1]);
        const isAuthz = upstreamStatus === 401 || upstreamStatus === 403;
        respondJson(res, isAuthz ? 403 : 502, {
          schemaVersion: CONTRACT_SCHEMA_VERSION, providerId: "google", connector: "calendar-write",
          error: { code: isAuthz ? "CALENDAR_WRITE_AUTHORIZATION_FAILED" : "CALENDAR_WRITE_UPSTREAM_ERROR", message, upstreamStatus }
        });
        return true;
      };

      // ── POST /integrations/google/calendar/events/create ──────────────────────
      if (req.method === "POST" && reqUrl.pathname === "/integrations/google/calendar/events/create") {
        const input = calendarCreateEventSchema.parse(await readJsonBody(req));
        const hasAttendees = Boolean(input.attendees && input.attendees.length > 0);
        const actionId = hasAttendees ? "calendar.event.create_with_attendees" : "calendar.event.create";
        const gate = await runCalendarWritePermission(input, actionId);
        if (!gate.allowed) return true;
        audit.emit({
          producingService: "api-gateway", eventType: "tool.invoked", severity: "info",
          traceId: trace.traceId, correlationId: trace.correlationId,
          reasonCodes: ["calendar_create_event_requested"],
          payload: {
            providerId: "google", actionId,
            calendarId: input.calendarId, summary: input.summary,
            hasAttendees, attendeeCount: input.attendees?.length ?? 0,
            startDateTime: input.startDateTime, endDateTime: input.endDateTime
          }
        });
        let result;
        try {
          result = await calendarWrite.createEvent(gate.accessToken, gate.account, {
            calendarId: input.calendarId,
            summary: input.summary,
            startDateTime: input.startDateTime,
            endDateTime: input.endDateTime,
            ...(input.timeZone ? { timeZone: input.timeZone } : {}),
            ...(input.description ? { description: input.description } : {}),
            ...(input.location ? { location: input.location } : {}),
            ...(input.attendees ? { attendees: input.attendees.map((a) => a.displayName !== undefined ? { email: a.email, displayName: a.displayName } : { email: a.email }) } : {}),
            ...(input.reminders ? { reminders: input.reminders } : {}),
            ...(input.visibility ? { visibility: input.visibility } : {}),
            ...(typeof input.guestsCanModify === "boolean" ? { guestsCanModify: input.guestsCanModify } : {}),
            ...(typeof input.guestsCanInviteOthers === "boolean" ? { guestsCanInviteOthers: input.guestsCanInviteOthers } : {}),
            ...(typeof input.sendNotifications === "boolean" ? { sendNotifications: input.sendNotifications } : {})
          });
        } catch (error) {
          audit.emit({ producingService: "api-gateway", eventType: "tool.failed", severity: "warn", traceId: trace.traceId, correlationId: trace.correlationId, reasonCodes: ["calendar_create_event_failed"], payload: { providerId: "google", error: error instanceof Error ? error.message.slice(0, 200) : "unknown" } });
          if (handleCalendarWriteUpstreamError(error)) return true;
          throw error;
        }
        audit.emit({
          producingService: "api-gateway", eventType: "tool.completed", severity: "info",
          traceId: trace.traceId, correlationId: trace.correlationId,
          reasonCodes: ["calendar_create_event_completed"],
          resource: { resourceClass: "integration-account", resourceId: gate.account.accountId },
          payload: {
            providerId: "google", actionId,
            eventId: result.eventId, calendarId: result.calendarId,
            summary: result.summary, startIso: result.startIso, endIso: result.endIso,
            hasAttendees: result.hasAttendees, attendeeCount: result.attendeeCount,
            hasConflict: result.conflictCheck?.hasConflict ?? false
          }
        });
        respondJson(res, 201, { schemaVersion: CONTRACT_SCHEMA_VERSION, providerId: "google", connector: "calendar-write", result });
        return true;
      }

      // ── POST /integrations/google/calendar/events/update ──────────────────────
      if (req.method === "POST" && reqUrl.pathname === "/integrations/google/calendar/events/update") {
        const input = calendarUpdateEventSchema.parse(await readJsonBody(req));
        const hasAttendeeMutation = Boolean(input.attendeesToAdd?.length || input.attendeesToRemove?.length);
        const actionId = hasAttendeeMutation ? "calendar.event.update_attendees" : "calendar.event.update";
        const gate = await runCalendarWritePermission(input, actionId);
        if (!gate.allowed) return true;
        audit.emit({
          producingService: "api-gateway", eventType: "tool.invoked", severity: "info",
          traceId: trace.traceId, correlationId: trace.correlationId,
          reasonCodes: ["calendar_update_event_requested"],
          payload: {
            providerId: "google", actionId,
            calendarId: input.calendarId, eventId: input.eventId,
            hasTimeChange: Boolean(input.startDateTime || input.endDateTime),
            hasAttendeeMutation
          }
        });
        let result;
        try {
          result = await calendarWrite.updateEvent(gate.accessToken, gate.account, {
            calendarId: input.calendarId,
            eventId: input.eventId,
            ...(input.summary ? { summary: input.summary } : {}),
            ...(input.description !== undefined ? { description: input.description } : {}),
            ...(input.location !== undefined ? { location: input.location } : {}),
            ...(input.startDateTime ? { startDateTime: input.startDateTime } : {}),
            ...(input.endDateTime ? { endDateTime: input.endDateTime } : {}),
            ...(input.timeZone ? { timeZone: input.timeZone } : {}),
            ...(input.attendeesToAdd ? { attendeesToAdd: input.attendeesToAdd.map((a) => a.displayName !== undefined ? { email: a.email, displayName: a.displayName } : { email: a.email }) } : {}),
            ...(input.attendeesToRemove ? { attendeesToRemove: input.attendeesToRemove } : {}),
            ...(input.reminders ? { reminders: input.reminders } : {}),
            ...(input.visibility ? { visibility: input.visibility } : {}),
            ...(typeof input.sendNotifications === "boolean" ? { sendNotifications: input.sendNotifications } : {})
          });
        } catch (error) {
          audit.emit({ producingService: "api-gateway", eventType: "tool.failed", severity: "warn", traceId: trace.traceId, correlationId: trace.correlationId, reasonCodes: ["calendar_update_event_failed"], payload: { providerId: "google", error: error instanceof Error ? error.message.slice(0, 200) : "unknown" } });
          if (handleCalendarWriteUpstreamError(error)) return true;
          throw error;
        }
        audit.emit({
          producingService: "api-gateway", eventType: "tool.completed", severity: "info",
          traceId: trace.traceId, correlationId: trace.correlationId,
          reasonCodes: ["calendar_update_event_completed"],
          resource: { resourceClass: "integration-account", resourceId: gate.account.accountId },
          payload: {
            providerId: "google", actionId,
            eventId: result.eventId, calendarId: result.calendarId,
            summary: result.summary, startIso: result.startIso, endIso: result.endIso,
            hasConflict: result.conflictCheck?.hasConflict ?? false
          }
        });
        respondJson(res, 200, { schemaVersion: CONTRACT_SCHEMA_VERSION, providerId: "google", connector: "calendar-write", result });
        return true;
      }

      // ── POST /integrations/google/calendar/events/delete ──────────────────────
      if (req.method === "POST" && reqUrl.pathname === "/integrations/google/calendar/events/delete") {
        const input = calendarDeleteEventSchema.parse(await readJsonBody(req));
        const gate = await runCalendarWritePermission(input, "calendar.event.delete");
        if (!gate.allowed) return true;
        audit.emit({
          producingService: "api-gateway", eventType: "tool.invoked", severity: "info",
          traceId: trace.traceId, correlationId: trace.correlationId,
          reasonCodes: ["calendar_delete_event_requested"],
          payload: { providerId: "google", actionId: "calendar.event.delete", calendarId: input.calendarId, eventId: input.eventId }
        });
        let result;
        try {
          result = await calendarWrite.deleteEvent(gate.accessToken, gate.account, {
            calendarId: input.calendarId,
            eventId: input.eventId,
            ...(typeof input.sendNotifications === "boolean" ? { sendNotifications: input.sendNotifications } : {})
          });
        } catch (error) {
          audit.emit({ producingService: "api-gateway", eventType: "tool.failed", severity: "warn", traceId: trace.traceId, correlationId: trace.correlationId, reasonCodes: ["calendar_delete_event_failed"], payload: { providerId: "google", error: error instanceof Error ? error.message.slice(0, 200) : "unknown" } });
          if (handleCalendarWriteUpstreamError(error)) return true;
          throw error;
        }
        audit.emit({
          producingService: "api-gateway", eventType: "tool.completed", severity: "info",
          traceId: trace.traceId, correlationId: trace.correlationId,
          reasonCodes: ["calendar_delete_event_completed"],
          resource: { resourceClass: "integration-account", resourceId: gate.account.accountId },
          payload: { providerId: "google", actionId: "calendar.event.delete", eventId: result.eventId, calendarId: result.calendarId, deletedAt: result.deletedAt }
        });
        respondJson(res, 200, { schemaVersion: CONTRACT_SCHEMA_VERSION, providerId: "google", connector: "calendar-write", result });
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
