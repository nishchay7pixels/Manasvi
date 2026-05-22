import { GOOGLE_SERVICES, getGoogleCapability, type GoogleService } from "../google-capabilities.js";
import type { NativeGoogleBackendConfig } from "../google-config.js";
import type {
  GoogleCapabilityExecutionRequest,
  GoogleCapabilityExecutionResult,
  GoogleProvider,
  GoogleProviderHealth
} from "../google-provider.js";
import { CalendarNativeClient } from "./native/calendar-native-client.js";
import { FetchNativeGoogleApiClient, type NativeGoogleApiClient } from "./native/google-api-client-factory.js";
import { googleOAuthConfigFromEnv, type GoogleOAuthConfig, type GoogleOAuthHttpClient } from "./native/google-oauth.js";
import {
  getMissingScopes,
  getRequiredScopesForCapability,
  hasRequiredScopes,
  listScopesByService
} from "./native/google-scope-registry.js";
import {
  decryptGoogleToken,
  encryptGoogleToken,
  LocalEncryptedGoogleTokenStore,
  redactGoogleTokenRecord,
  type GoogleTokenRecord,
  type GoogleTokenStore
} from "./native/google-token-store.js";
import { GmailNativeClient } from "./native/gmail-native-client.js";
import { NativeGoogleError, sanitizeNativeGoogleError } from "./native/native-errors.js";

export interface NativeApprovalVerifier {
  verify(request: GoogleCapabilityExecutionRequest<unknown>): Promise<boolean>;
}

export interface NativeGoogleProviderOptions {
  config?: NativeGoogleBackendConfig;
  oauthConfig?: GoogleOAuthConfig | null;
  tokenStore?: GoogleTokenStore;
  tokenEncryptionKey?: string;
  apiClient?: NativeGoogleApiClient;
  oauthHttpClient?: GoogleOAuthHttpClient;
  approvalVerifier?: NativeApprovalVerifier;
  env?: NodeJS.ProcessEnv;
}

interface AuthorizedNativeClient {
  accessToken: string;
  account?: string;
  token: GoogleTokenRecord;
  grantedScopes: string[];
}

const NATIVE_GMAIL_CAPABILITIES = new Set([
  "google.gmail.search",
  "google.gmail.read",
  "google.gmail.draft",
  "google.gmail.send"
]);

const NATIVE_CALENDAR_CAPABILITIES = new Set([
  "google.calendar.list",
  "google.calendar.create",
  "google.calendar.update",
  "google.calendar.delete"
]);

function serviceScopes(service: GoogleService, grantedScopes: string[]): { grantedScopes: string[]; missingScopes: string[] } {
  const required = listScopesByService(service);
  return {
    grantedScopes: grantedScopes.filter((scope) => required.includes(scope)),
    missingScopes: required.filter((scope) => !grantedScopes.includes(scope))
  };
}

function isExpired(expiryDate?: string): boolean {
  if (!expiryDate) return false;
  const time = Date.parse(expiryDate);
  return Number.isFinite(time) && time <= Date.now() + 60_000;
}

function statusFromNativeError(error: NativeGoogleError): GoogleCapabilityExecutionResult["status"] {
  if (error.code === "missing_scope") return "missing_scope";
  if (error.code === "not_configured") return "not_configured";
  if (error.code === "not_connected") return "not_connected";
  if (error.code === "approval_required" || error.code === "approval_verification_unavailable") return "blocked";
  return "failed";
}

export class NativeGoogleProvider implements GoogleProvider {
  readonly id = "native" as const;

  private readonly oauthConfig: GoogleOAuthConfig | null;
  private readonly tokenStore: GoogleTokenStore;
  private readonly apiClient: NativeGoogleApiClient;
  private readonly oauthHttpClient: GoogleOAuthHttpClient | undefined;
  private readonly tokenEncryptionKey: string | undefined;
  private readonly approvalVerifier: NativeApprovalVerifier | undefined;
  private readonly gmail: GmailNativeClient;
  private readonly calendar: CalendarNativeClient;

  constructor(options: NativeGoogleProviderOptions = {}) {
    const env = options.env ?? process.env;
    this.oauthConfig = options.oauthConfig ?? googleOAuthConfigFromEnv(env, options.config?.redirectUri);
    this.tokenStore = options.tokenStore ?? new LocalEncryptedGoogleTokenStore({
      ...(options.config?.tokenStore?.path ? { filePath: options.config.tokenStore.path } : {}),
      ...(options.tokenEncryptionKey ? { encryptionKey: options.tokenEncryptionKey } : {})
    });
    this.apiClient = options.apiClient ?? new FetchNativeGoogleApiClient();
    this.oauthHttpClient = options.oauthHttpClient;
    this.tokenEncryptionKey = options.tokenEncryptionKey ?? env[options.config?.tokenEncryptionKeyEnv ?? "GOOGLE_TOKEN_ENCRYPTION_KEY"];
    this.approvalVerifier = options.approvalVerifier;
    this.gmail = new GmailNativeClient(this.apiClient);
    this.calendar = new CalendarNativeClient(this.apiClient);
  }

  supports(capabilityId: string): boolean {
    return getGoogleCapability(capabilityId)?.supportedBackends.includes(this.id) ?? false;
  }

  async healthCheck(): Promise<GoogleProviderHealth> {
    const token = await this.tokenStore.getDefault();
    const grantedScopes = token?.grantedScopes ?? [];
    const services = Object.fromEntries(GOOGLE_SERVICES.map((service) => {
      const scopes = serviceScopes(service, grantedScopes);
      const relevantForG3 = service === "gmail" || service === "calendar";
      const reason = !this.oauthConfig
        ? "Google OAuth client is not configured."
        : !token
          ? "Google native backend is not connected."
          : scopes.grantedScopes.length === 0
            ? "Required scopes are not granted."
            : undefined;
      return [
        service,
        {
          enabled: relevantForG3,
          connected: Boolean(this.oauthConfig && token && relevantForG3 && scopes.grantedScopes.length > 0),
          ...(reason ? { reason } : {}),
          grantedScopes: scopes.grantedScopes,
          missingScopes: scopes.missingScopes
        }
      ];
    }));

    const errors: string[] = [];
    const warnings: string[] = ["Native Google clients are provider internals, not agent-facing clients."];
    const nextSteps: string[] = [];
    if (!this.oauthConfig) {
      errors.push("Google OAuth client is not configured.");
      nextSteps.push("Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET.");
    }
    if (!token) {
      errors.push("Google native backend is not connected.");
      nextSteps.push("Run: pnpm manasvi connect google --mode native");
    } else if (!token.refreshTokenEncrypted) {
      warnings.push("Google refresh token is missing; reconnect with offline access if refresh is needed.");
    }

    return {
      provider: this.id,
      ok: Boolean(this.oauthConfig && token),
      status: !this.oauthConfig ? "not_configured" : token ? "available" : "not_connected",
      ...(token?.account ? { account: token.account } : {}),
      services,
      warnings,
      errors,
      nextSteps
    };
  }

  async execute<TInput = unknown, TResult = unknown>(
    request: GoogleCapabilityExecutionRequest<TInput>
  ): Promise<GoogleCapabilityExecutionResult<TResult>> {
    const capability = getGoogleCapability(request.capabilityId);
    const started = Date.now();
    const auditBase = {
      correlationId: request.correlationId,
      principal: request.principal,
      capability: request.capabilityId,
      backend: "native",
      service: capability?.service,
      action: capability?.action,
      effect: capability?.effect,
      sensitivity: capability?.sensitivity,
      requiresApproval: capability?.requiresApproval ?? false,
      approval: request.approval ? { approved: request.approval.approved, approvalId: request.approval.approvalId } : undefined,
      rawGoogleClientExposed: false,
      oauthTokenExposed: false
    };

    try {
      if (!capability) throw new NativeGoogleError(`Unknown Google capability: ${request.capabilityId}`, "validation_error");
      if (!this.supports(request.capabilityId)) throw new NativeGoogleError(`Capability ${request.capabilityId} is not supported by native Google APIs.`, "validation_error");
      if (!NATIVE_GMAIL_CAPABILITIES.has(request.capabilityId) && !NATIVE_CALENDAR_CAPABILITIES.has(request.capabilityId)) {
        throw new NativeGoogleError(`Native execution for ${request.capabilityId} is not implemented in G3.`, "validation_error");
      }

      const requiredScopes = getRequiredScopesForCapability(request.capabilityId);
      const authorized = await this.getAuthorizedGoogleClient();
      const missingScopes = getMissingScopes(request.capabilityId, authorized.grantedScopes);
      if (missingScopes.length > 0) {
        return {
          ok: false,
          capabilityId: request.capabilityId,
          provider: this.id,
          status: "missing_scope",
          warnings: [],
          errors: missingScopes.map((scope) => `Missing required Google scope: ${scope}`),
          nextSteps: [`Run: pnpm manasvi connect google ${capability.service} --mode native --scope ${capability.requiresApproval ? "write" : "read"}`],
          audit: {
            ...auditBase,
            account: authorized.account,
            requiredScopes,
            grantedScopesChecked: true,
            missingScopes,
            executed: false,
            status: "blocked",
            blockedReason: "missing_scope"
          }
        };
      }

      if (capability.requiresApproval) {
        if (request.approval?.approved !== true) {
          throw new NativeGoogleError(`${request.capabilityId} requires approval before execution.`, "approval_required");
        }
        if (!this.approvalVerifier || !(await this.approvalVerifier.verify(request as GoogleCapabilityExecutionRequest<unknown>))) {
          throw new NativeGoogleError(`${request.capabilityId} requires verified policy approval before native execution.`, "approval_verification_unavailable");
        }
      }

      if (request.dryRun) {
        return {
          ok: false,
          capabilityId: request.capabilityId,
          provider: this.id,
          status: "blocked",
          warnings: ["Dry run requested; native Google API call was not executed."],
          errors: [],
          audit: {
            ...auditBase,
            account: authorized.account,
            requiredScopes,
            grantedScopesChecked: true,
            executed: false,
            status: "blocked",
            blockedReason: "dry_run"
          }
        };
      }

      const data = await this.dispatch(request.capabilityId, authorized.accessToken, request.input);
      return {
        ok: true,
        capabilityId: request.capabilityId,
        provider: this.id,
        status: "completed",
        data: data as TResult,
        warnings: [],
        errors: [],
        audit: {
          ...auditBase,
          account: authorized.account,
          requiredScopes,
          grantedScopesChecked: true,
          executed: true,
          status: "completed",
          durationMs: Date.now() - started
        }
      };
    } catch (error) {
      if (error instanceof NativeGoogleError) {
        return {
          ok: false,
          capabilityId: request.capabilityId,
          provider: this.id,
          status: statusFromNativeError(error),
          warnings: [],
          errors: [error.message],
          nextSteps: error.code === "not_configured"
            ? ["Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET.", "Run: pnpm manasvi connect google --mode native"]
            : error.code === "not_connected"
              ? ["Run: pnpm manasvi connect google --mode native"]
              : [],
          audit: {
            ...auditBase,
            executed: false,
            status: statusFromNativeError(error) === "failed" ? "failed" : "blocked",
            blockedReason: error.code,
            durationMs: Date.now() - started
          }
        };
      }
      return {
        ok: false,
        capabilityId: request.capabilityId,
        provider: this.id,
        status: "failed",
        warnings: [],
        errors: [sanitizeNativeGoogleError(error)],
        audit: {
          ...auditBase,
          executed: false,
          status: "failed",
          durationMs: Date.now() - started
        }
      };
    }
  }

  private async dispatch(capabilityId: string, accessToken: string, input: unknown): Promise<unknown> {
    switch (capabilityId) {
      case "google.gmail.search":
        return this.gmail.search(accessToken, input);
      case "google.gmail.read":
        return this.gmail.read(accessToken, input);
      case "google.gmail.draft":
        return this.gmail.draft(accessToken, input);
      case "google.gmail.send":
        return this.gmail.send(accessToken, input);
      case "google.calendar.list":
        return this.calendar.list(accessToken, input);
      case "google.calendar.create":
        return this.calendar.create(accessToken, input);
      case "google.calendar.update":
        return this.calendar.update(accessToken, input);
      case "google.calendar.delete":
        return this.calendar.delete(accessToken, input);
      default:
        throw new NativeGoogleError(`Native execution for ${capabilityId} is not implemented in G3.`, "validation_error");
    }
  }

  private async getAuthorizedGoogleClient(account?: string): Promise<AuthorizedNativeClient> {
    if (!this.oauthConfig) {
      throw new NativeGoogleError("Google OAuth client is not configured.", "not_configured");
    }
    const token = account ? await this.tokenStore.getByAccount(account) : await this.tokenStore.getDefault();
    if (!token) {
      throw new NativeGoogleError("Google native backend is not connected.", "not_connected");
    }
    const accessToken = await this.decryptAccessToken(token);
    if (!accessToken) {
      throw new NativeGoogleError("Google access token is not available.", "not_connected");
    }
    if (!isExpired(token.expiryDate)) {
      return { accessToken, ...(token.account ? { account: token.account } : {}), token, grantedScopes: token.grantedScopes };
    }
    const refreshed = await this.refreshToken(token);
    return {
      accessToken: refreshed.accessToken,
      ...(refreshed.token.account ? { account: refreshed.token.account } : {}),
      token: refreshed.token,
      grantedScopes: refreshed.token.grantedScopes
    };
  }

  private async decryptAccessToken(token: GoogleTokenRecord): Promise<string | null> {
    if (!token.accessTokenEncrypted) return null;
    if (this.tokenStore instanceof LocalEncryptedGoogleTokenStore) {
      return this.tokenStore.decryptAccessToken(token);
    }
    if (!this.tokenEncryptionKey) throw new NativeGoogleError("Google token encryption key is not configured.", "not_configured");
    return decryptGoogleToken(token.accessTokenEncrypted, this.tokenEncryptionKey);
  }

  private async decryptRefreshToken(token: GoogleTokenRecord): Promise<string | null> {
    if (!token.refreshTokenEncrypted) return null;
    if (this.tokenStore instanceof LocalEncryptedGoogleTokenStore) {
      return this.tokenStore.decryptRefreshToken(token);
    }
    if (!this.tokenEncryptionKey) throw new NativeGoogleError("Google token encryption key is not configured.", "not_configured");
    return decryptGoogleToken(token.refreshTokenEncrypted, this.tokenEncryptionKey);
  }

  private async encryptToken(token: string): Promise<string> {
    if (this.tokenStore instanceof LocalEncryptedGoogleTokenStore) {
      return this.tokenStore.encryptToken(token);
    }
    if (!this.tokenEncryptionKey) throw new NativeGoogleError("Google token encryption key is not configured.", "not_configured");
    return encryptGoogleToken(token, this.tokenEncryptionKey);
  }

  private async refreshToken(token: GoogleTokenRecord): Promise<{ accessToken: string; token: GoogleTokenRecord }> {
    const refreshToken = await this.decryptRefreshToken(token);
    if (!refreshToken) throw new NativeGoogleError("Google refresh token is not available.", "not_connected");
    if (!this.oauthHttpClient) throw new NativeGoogleError("Google OAuth refresh client is not configured.", "not_connected");
    const refreshed = await this.oauthHttpClient.refresh({
      clientId: this.oauthConfig!.clientId,
      clientSecret: this.oauthConfig!.clientSecret,
      refreshToken
    });
    if (!refreshed.access_token) throw new NativeGoogleError("Google OAuth refresh did not return an access token.", "not_connected");
    const expiryDate = refreshed.expires_in ? new Date(Date.now() + refreshed.expires_in * 1000).toISOString() : token.expiryDate;
    const next: GoogleTokenRecord = {
      ...token,
      accessTokenEncrypted: await this.encryptToken(refreshed.access_token),
      ...(refreshed.refresh_token ? { refreshTokenEncrypted: await this.encryptToken(refreshed.refresh_token) } : {}),
      ...(refreshed.token_type ? { tokenType: refreshed.token_type } : {}),
      ...(expiryDate ? { expiryDate } : {}),
      grantedScopes: refreshed.scope ? refreshed.scope.split(/\s+/).filter(Boolean) : token.grantedScopes,
      updatedAt: new Date().toISOString()
    };
    const saved = await this.tokenStore.update(next);
    return { accessToken: refreshed.access_token, token: saved };
  }

  async tokenStatus(): Promise<ReturnType<typeof redactGoogleTokenRecord> | null> {
    const token = await this.tokenStore.getDefault();
    return token ? redactGoogleTokenRecord(token) : null;
  }
}

export { getRequiredScopesForCapability, getMissingScopes, hasRequiredScopes, listScopesByService };
