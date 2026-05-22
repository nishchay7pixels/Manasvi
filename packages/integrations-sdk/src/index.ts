import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
export * from "./permissions.js";
export * from "./gmail.js";
export * from "./calendar.js";
export * from "./google-capabilities.js";
export * from "./google-config.js";
export * from "./google-provider.js";
export * from "./google-capability-router.js";
export * from "./google-capability-inputs.js";
export * from "./providers/gog-google-provider.js";
export * from "./providers/native-google-provider.js";
export * from "./providers/gog/gog-process-runner.js";
export * from "./providers/gog/gog-health-check.js";
export * from "./providers/gog/gog-command-builder.js";
export * from "./providers/gog/gog-output-parsers.js";
export * from "./providers/native/google-oauth.js";
export * from "./providers/native/google-token-store.js";
export * from "./providers/native/google-scope-registry.js";
export * from "./providers/native/google-api-client-factory.js";
export * from "./providers/native/gmail-native-client.js";
export * from "./providers/native/calendar-native-client.js";
export * from "./providers/native/native-output-normalizers.js";
export * from "./providers/native/native-errors.js";

export type IntegrationProviderId = "google";

export type IntegrationStatus =
  | "not_connected"
  | "pending_auth"
  | "connected"
  | "token_refresh_needed"
  | "refresh_failed"
  | "revoked"
  | "disconnected"
  | "error";

export interface ConnectorDescriptor {
  connectorId: string;
  providerId: IntegrationProviderId;
  providerName: string;
  authType: "oauth2";
  capabilities: string[];
  supportedFamilies: string[];
  defaultScopes: string[];
}

export interface IntegrationAccountRecord {
  accountId: string;
  providerId: IntegrationProviderId;
  connectorId: string;
  providerAccountId: string;
  displayName?: string;
  status: IntegrationStatus;
  scopesGranted: string[];
  tokenReference: string | null;
  refreshTokenReference: string | null;
  tokenExpiresAt: string | null;
  lastAuthAt: string | null;
  lastRefreshAt: string | null;
  lastError: string | null;
  revokedAt: string | null;
  disconnectedAt: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface StoredTokenSet {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string;
  idToken?: string;
  tokenType?: string;
}

export interface OAuthProviderProfile {
  providerId: IntegrationProviderId;
  authBaseUrl: string;
  tokenUrl: string;
  revokeUrl: string;
  scopeJoiner: "space";
}

interface IntegrationAccountCollection {
  version: "1";
  accounts: IntegrationAccountRecord[];
}

interface OAuthStateRecord {
  stateId: string;
  providerId: IntegrationProviderId;
  connectorId: string;
  createdAt: string;
  expiresAt: string;
  redirectUri: string;
  returnTo?: string;
  actorPrincipalId?: string;
  tenantId?: string;
  workspaceId?: string;
  scopes: string[];
}

interface OAuthStateCollection {
  version: "1";
  states: OAuthStateRecord[];
}

export class ConnectorRegistry {
  private readonly connectors = new Map<string, ConnectorDescriptor>();

  register(connector: ConnectorDescriptor): void {
    if (this.connectors.has(connector.connectorId)) {
      throw new Error(`Connector already registered: ${connector.connectorId}`);
    }
    this.connectors.set(connector.connectorId, connector);
  }

  getById(connectorId: string): ConnectorDescriptor | undefined {
    return this.connectors.get(connectorId);
  }

  list(): ConnectorDescriptor[] {
    return [...this.connectors.values()];
  }
}

export const GOOGLE_PROVIDER_PROFILE: OAuthProviderProfile = {
  providerId: "google",
  authBaseUrl: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenUrl: "https://oauth2.googleapis.com/token",
  revokeUrl: "https://oauth2.googleapis.com/revoke",
  scopeJoiner: "space"
};

export function createGoogleConnector(): ConnectorDescriptor {
  return {
    connectorId: "google-foundation",
    providerId: "google",
    providerName: "Google",
    authType: "oauth2",
    capabilities: ["oauth_connect", "token_refresh", "revoke", "status"],
    supportedFamilies: ["gmail", "calendar", "drive", "docs"],
    defaultScopes: ["openid", "email", "profile"]
  };
}

function hashState(stateId: string): string {
  return createHash("sha256").update(stateId).digest("hex");
}

export class OAuthStateStore {
  constructor(private readonly filePath: string) {}

  async create(input: {
    providerId: IntegrationProviderId;
    connectorId: string;
    redirectUri: string;
    scopes: string[];
    ttlSeconds: number;
    returnTo?: string;
    actorPrincipalId?: string;
    tenantId?: string;
    workspaceId?: string;
  }): Promise<{ state: string; stateId: string; expiresAt: string }> {
    const state = randomBytes(24).toString("base64url");
    const record: OAuthStateRecord = {
      stateId: hashState(state),
      providerId: input.providerId,
      connectorId: input.connectorId,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + input.ttlSeconds * 1000).toISOString(),
      redirectUri: input.redirectUri,
      scopes: input.scopes
    };
    if (input.returnTo) record.returnTo = input.returnTo;
    if (input.actorPrincipalId) record.actorPrincipalId = input.actorPrincipalId;
    if (input.tenantId) record.tenantId = input.tenantId;
    if (input.workspaceId) record.workspaceId = input.workspaceId;

    const collection = await this.load();
    collection.states = collection.states.filter((s: OAuthStateRecord) => new Date(s.expiresAt).getTime() > Date.now());
    collection.states.push(record);
    await this.save(collection);
    return { state, stateId: record.stateId, expiresAt: record.expiresAt };
  }

  async consume(state: string): Promise<OAuthStateRecord | null> {
    const stateId = hashState(state);
    const collection = await this.load();
    const found = collection.states.find((entry: OAuthStateRecord) => entry.stateId === stateId);
    collection.states = collection.states.filter((entry: OAuthStateRecord) => entry.stateId !== stateId);
    await this.save(collection);
    if (!found) return null;
    if (new Date(found.expiresAt).getTime() <= Date.now()) return null;
    return found;
  }

  private async load(): Promise<OAuthStateCollection> {
    try {
      const content = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(content) as OAuthStateCollection;
      return parsed.version === "1" && Array.isArray(parsed.states) ? parsed : { version: "1", states: [] };
    } catch {
      return { version: "1", states: [] };
    }
  }

  private async save(collection: OAuthStateCollection): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(collection, null, 2), "utf8");
  }
}

function deriveAesKey(secret: string): Buffer {
  return createHash("sha256").update(secret).digest();
}

function encrypt(secret: string, plaintext: string): string {
  const iv = randomBytes(12);
  const key = deriveAesKey(secret);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64url")}.${encrypted.toString("base64url")}.${tag.toString("base64url")}`;
}

function decrypt(secret: string, encoded: string): string {
  const [ivB64, payloadB64, tagB64] = encoded.split(".");
  if (!ivB64 || !payloadB64 || !tagB64) throw new Error("Malformed secret payload");
  const decipher = createDecipheriv("aes-256-gcm", deriveAesKey(secret), Buffer.from(ivB64, "base64url"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(payloadB64, "base64url")), decipher.final()]);
  return decrypted.toString("utf8");
}

export class EncryptedTokenVault {
  constructor(private readonly filePath: string, private readonly encryptionSecret: string) {}

  async put(reference: string, tokens: StoredTokenSet): Promise<void> {
    const store = await this.load();
    store[reference] = encrypt(this.encryptionSecret, JSON.stringify(tokens));
    await this.save(store);
  }

  async get(reference: string): Promise<StoredTokenSet | null> {
    const store = await this.load();
    const value = store[reference];
    if (!value) return null;
    return JSON.parse(decrypt(this.encryptionSecret, value)) as StoredTokenSet;
  }

  async delete(reference: string): Promise<void> {
    const store = await this.load();
    delete store[reference];
    await this.save(store);
  }

  private async load(): Promise<Record<string, string>> {
    try {
      const content = await readFile(this.filePath, "utf8");
      return JSON.parse(content) as Record<string, string>;
    } catch {
      return {};
    }
  }

  private async save(store: Record<string, string>): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(store, null, 2), "utf8");
  }
}

export class IntegrationAccountStore {
  constructor(private readonly filePath: string) {}

  async list(): Promise<IntegrationAccountRecord[]> {
    return (await this.load()).accounts;
  }

  async getByProvider(providerId: IntegrationProviderId): Promise<IntegrationAccountRecord | null> {
    return (await this.load()).accounts.find((a: IntegrationAccountRecord) => a.providerId === providerId && a.status !== "disconnected") ?? null;
  }

  async upsert(input: Omit<IntegrationAccountRecord, "createdAt" | "updatedAt">): Promise<IntegrationAccountRecord> {
    const collection = await this.load();
    const now = new Date().toISOString();
    const idx = collection.accounts.findIndex((a: IntegrationAccountRecord) => a.accountId === input.accountId);
    if (idx === -1) {
      const next: IntegrationAccountRecord = { ...input, createdAt: now, updatedAt: now };
      collection.accounts.push(next);
      await this.save(collection);
      return next;
    }
    const prev = collection.accounts[idx];
    if (!prev) {
      throw new Error(`Integration account not found at index ${idx}`);
    }
    const next: IntegrationAccountRecord = {
      ...prev,
      ...input,
      createdAt: prev.createdAt,
      updatedAt: now
    };
    collection.accounts[idx] = next;
    await this.save(collection);
    return next;
  }

  async setStatus(accountId: string, status: IntegrationStatus, lastError: string | null = null): Promise<void> {
    const collection = await this.load();
    const idx = collection.accounts.findIndex((a: IntegrationAccountRecord) => a.accountId === accountId);
    if (idx === -1) throw new Error(`Integration account not found: ${accountId}`);
    const prev = collection.accounts[idx];
    if (!prev) {
      throw new Error(`Integration account not found at index ${idx}`);
    }
    collection.accounts[idx] = {
      ...prev,
      status,
      lastError,
      createdAt: prev.createdAt,
      updatedAt: new Date().toISOString()
    };
    await this.save(collection);
  }

  private async load(): Promise<IntegrationAccountCollection> {
    try {
      const content = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(content) as IntegrationAccountCollection;
      return parsed.version === "1" && Array.isArray(parsed.accounts) ? parsed : { version: "1", accounts: [] };
    } catch {
      return { version: "1", accounts: [] };
    }
  }

  private async save(collection: IntegrationAccountCollection): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(collection, null, 2), "utf8");
  }
}

export interface OAuthTokenExchangeResult {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
  tokenType?: string;
  idToken?: string;
}

export interface OAuthClient {
  exchangeCode(input: {
    tokenUrl: string;
    code: string;
    clientId: string;
    clientSecret: string;
    redirectUri: string;
  }): Promise<OAuthTokenExchangeResult>;
  refreshToken(input: {
    tokenUrl: string;
    refreshToken: string;
    clientId: string;
    clientSecret: string;
  }): Promise<OAuthTokenExchangeResult>;
  revokeToken(input: { revokeUrl: string; token: string }): Promise<void>;
}

function buildTokenResult(payload: Record<string, unknown>): OAuthTokenExchangeResult {
  const out: OAuthTokenExchangeResult = {
    accessToken: String(payload.access_token ?? "")
  };
  if (payload.refresh_token) out.refreshToken = String(payload.refresh_token);
  if (payload.expires_in) out.expiresIn = Number(payload.expires_in);
  if (payload.token_type) out.tokenType = String(payload.token_type);
  if (payload.id_token) out.idToken = String(payload.id_token);
  return out;
}

export class FetchOAuthClient implements OAuthClient {
  async exchangeCode(input: {
    tokenUrl: string;
    code: string;
    clientId: string;
    clientSecret: string;
    redirectUri: string;
  }): Promise<OAuthTokenExchangeResult> {
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code: input.code,
      client_id: input.clientId,
      client_secret: input.clientSecret,
      redirect_uri: input.redirectUri
    });
    const response = await fetch(input.tokenUrl, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString()
    });
    if (!response.ok) throw new Error(`OAuth token exchange failed (${response.status})`);
    return buildTokenResult((await response.json()) as Record<string, unknown>);
  }

  async refreshToken(input: {
    tokenUrl: string;
    refreshToken: string;
    clientId: string;
    clientSecret: string;
  }): Promise<OAuthTokenExchangeResult> {
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: input.refreshToken,
      client_id: input.clientId,
      client_secret: input.clientSecret
    });
    const response = await fetch(input.tokenUrl, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString()
    });
    if (!response.ok) {
      const upstreamBody = await response.text().catch(() => "");
      const detail = upstreamBody.trim().slice(0, 600);
      throw new Error(`OAuth token refresh failed (${response.status})${detail ? `: ${detail}` : ""}`);
    }
    return buildTokenResult((await response.json()) as Record<string, unknown>);
  }

  async revokeToken(input: { revokeUrl: string; token: string }): Promise<void> {
    const body = new URLSearchParams({ token: input.token });
    await fetch(input.revokeUrl, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString()
    });
  }
}

export interface OAuthFlowServiceOptions {
  connectorRegistry: ConnectorRegistry;
  stateStore: OAuthStateStore;
  accountStore: IntegrationAccountStore;
  tokenVault: EncryptedTokenVault;
  oauthClient: OAuthClient;
  providerProfile: OAuthProviderProfile;
  clientId: string;
  clientSecret: string;
  defaultRedirectUri: string;
}

export class OAuthFlowService {
  constructor(private readonly options: OAuthFlowServiceOptions) {}

  async startGoogleFlow(input: {
    scopes: string[];
    redirectUri?: string;
    returnTo?: string;
    actorPrincipalId?: string;
    tenantId?: string;
    workspaceId?: string;
  }): Promise<{ authorizeUrl: string; stateExpiresAt: string }> {
    const connector = this.options.connectorRegistry.getById("google-foundation");
    if (!connector) throw new Error("Google connector is not registered");

    const stateInput: Parameters<OAuthStateStore["create"]>[0] = {
      providerId: "google",
      connectorId: connector.connectorId,
      redirectUri: input.redirectUri ?? this.options.defaultRedirectUri,
      scopes: input.scopes,
      ttlSeconds: 600
    };
    if (input.returnTo) stateInput.returnTo = input.returnTo;
    if (input.actorPrincipalId) stateInput.actorPrincipalId = input.actorPrincipalId;
    if (input.tenantId) stateInput.tenantId = input.tenantId;
    if (input.workspaceId) stateInput.workspaceId = input.workspaceId;

    const state = await this.options.stateStore.create(stateInput);
    const params = new URLSearchParams({
      client_id: this.options.clientId,
      response_type: "code",
      redirect_uri: stateInput.redirectUri,
      scope: input.scopes.join(" "),
      access_type: "offline",
      include_granted_scopes: "true",
      prompt: "consent",
      state: state.state
    });

    return {
      authorizeUrl: `${this.options.providerProfile.authBaseUrl}?${params.toString()}`,
      stateExpiresAt: state.expiresAt
    };
  }

  async completeGoogleCallback(input: { state: string; code: string }): Promise<IntegrationAccountRecord> {
    const consumed = await this.options.stateStore.consume(input.state);
    if (!consumed) throw new Error("OAuth state is invalid or expired");

    const exchanged = await this.options.oauthClient.exchangeCode({
      tokenUrl: this.options.providerProfile.tokenUrl,
      code: input.code,
      clientId: this.options.clientId,
      clientSecret: this.options.clientSecret,
      redirectUri: consumed.redirectUri
    });
    if (!exchanged.accessToken) throw new Error("OAuth exchange did not return an access token");

    const accountId = `integration:${consumed.providerId}:${randomUUID()}`;
    const tokenReference = `secretref:integration.${accountId}.access`;
    const refreshReference = exchanged.refreshToken ? `secretref:integration.${accountId}.refresh` : null;
    const expiresAt = exchanged.expiresIn ? new Date(Date.now() + exchanged.expiresIn * 1000).toISOString() : null;

    const accessPayload: StoredTokenSet = { accessToken: exchanged.accessToken };
    if (expiresAt) accessPayload.expiresAt = expiresAt;
    if (exchanged.tokenType) accessPayload.tokenType = exchanged.tokenType;
    if (exchanged.idToken) accessPayload.idToken = exchanged.idToken;
    await this.options.tokenVault.put(tokenReference, accessPayload);

    if (refreshReference && exchanged.refreshToken) {
      await this.options.tokenVault.put(refreshReference, { accessToken: exchanged.refreshToken });
    }

    return this.options.accountStore.upsert({
      accountId,
      providerId: consumed.providerId,
      connectorId: consumed.connectorId,
      providerAccountId: `google-account:${randomUUID().slice(0, 12)}`,
      status: "connected",
      scopesGranted: consumed.scopes,
      tokenReference,
      refreshTokenReference: refreshReference,
      tokenExpiresAt: expiresAt,
      lastAuthAt: new Date().toISOString(),
      lastRefreshAt: null,
      lastError: null,
      revokedAt: null,
      disconnectedAt: null,
      metadata: { oauthStateId: consumed.stateId }
    });
  }

  async refreshGoogle(account: IntegrationAccountRecord): Promise<IntegrationAccountRecord> {
    if (!account.refreshTokenReference) {
      await this.options.accountStore.setStatus(account.accountId, "refresh_failed", "No refresh token available");
      throw new Error("No refresh token available");
    }
    const refreshSecret = await this.options.tokenVault.get(account.refreshTokenReference);
    if (!refreshSecret?.accessToken) {
      await this.options.accountStore.setStatus(account.accountId, "refresh_failed", "Missing refresh token payload");
      throw new Error("Missing refresh token payload");
    }

    const result = await this.options.oauthClient.refreshToken({
      tokenUrl: this.options.providerProfile.tokenUrl,
      refreshToken: refreshSecret.accessToken,
      clientId: this.options.clientId,
      clientSecret: this.options.clientSecret
    });

    const expiresAt = result.expiresIn ? new Date(Date.now() + result.expiresIn * 1000).toISOString() : account.tokenExpiresAt;
    if (account.tokenReference) {
      const tokenPayload: StoredTokenSet = { accessToken: result.accessToken };
      if (expiresAt) tokenPayload.expiresAt = expiresAt;
      if (result.tokenType) tokenPayload.tokenType = result.tokenType;
      await this.options.tokenVault.put(account.tokenReference, tokenPayload);
    }

    return this.options.accountStore.upsert({
      ...account,
      status: "connected",
      tokenExpiresAt: expiresAt,
      lastRefreshAt: new Date().toISOString(),
      lastError: null
    });
  }

  async disconnectGoogle(account: IntegrationAccountRecord): Promise<IntegrationAccountRecord> {
    if (account.tokenReference) {
      const tokenPayload = await this.options.tokenVault.get(account.tokenReference);
      if (tokenPayload?.accessToken) {
        await this.options.oauthClient.revokeToken({
          revokeUrl: this.options.providerProfile.revokeUrl,
          token: tokenPayload.accessToken
        });
      }
      await this.options.tokenVault.delete(account.tokenReference);
    }
    if (account.refreshTokenReference) {
      await this.options.tokenVault.delete(account.refreshTokenReference);
    }

    return this.options.accountStore.upsert({
      ...account,
      status: "disconnected",
      disconnectedAt: new Date().toISOString(),
      revokedAt: new Date().toISOString(),
      tokenReference: null,
      refreshTokenReference: null,
      lastError: null
    });
  }
}
