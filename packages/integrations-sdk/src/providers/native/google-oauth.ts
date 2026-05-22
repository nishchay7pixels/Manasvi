import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import {
  ensureGoogleTokenEncryptionKey,
  encryptGoogleToken,
  LocalEncryptedGoogleTokenStore,
  type GoogleTokenRecord,
  type GoogleTokenStore
} from "./google-token-store.js";

export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface GoogleOAuthStartRequest {
  accountHint?: string;
  requestedScopes: string[];
  state: string;
}

export interface GoogleOAuthStartResult {
  authorizationUrl: string;
  state: string;
  requestedScopes: string[];
  expiresAt?: string;
}

export interface GoogleOAuthCallbackRequest {
  code: string;
  state: string;
}

export interface GoogleOAuthCallbackResult {
  account?: string;
  grantedScopes: string[];
  tokenRecordId: string;
}

export interface GoogleOAuthState {
  state: string;
  createdAt: string;
  expiresAt: string;
  requestedScopes: string[];
  mode: "native";
  accountHint?: string;
  principal?: {
    id?: string;
    type?: string;
  };
  usedAt?: string;
}

interface GoogleOAuthStateCollection {
  version: "1";
  states: GoogleOAuthState[];
}

export interface GoogleOAuthTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  scope?: string;
  id_token?: string;
}

export interface GoogleOAuthHttpClient {
  exchangeCode(input: GoogleOAuthConfig & { code: string }): Promise<GoogleOAuthTokenResponse>;
  refresh(input: Pick<GoogleOAuthConfig, "clientId" | "clientSecret"> & { refreshToken: string }): Promise<GoogleOAuthTokenResponse>;
}

export function defaultGoogleOAuthStateStorePath(): string {
  return join(process.env.MANASVI_HOME ?? join(homedir(), ".manasvi"), "integrations", "google", "oauth-states.json");
}

export function generateGoogleOAuthState(): string {
  return randomBytes(24).toString("base64url");
}

export class FileGoogleOAuthStateStore {
  constructor(private readonly filePath = defaultGoogleOAuthStateStorePath()) {}

  async save(state: GoogleOAuthState): Promise<GoogleOAuthState> {
    const collection = await this.load();
    collection.states = collection.states.filter((item) => new Date(item.expiresAt).getTime() > Date.now() && !item.usedAt);
    collection.states.push(state);
    await this.persist(collection);
    return state;
  }

  async consume(state: string): Promise<GoogleOAuthState | null> {
    const collection = await this.load();
    const found = collection.states.find((item) => item.state === state);
    collection.states = collection.states.map((item) => item.state === state ? { ...item, usedAt: new Date().toISOString() } : item);
    await this.persist(collection);
    if (!found || found.usedAt) return null;
    if (new Date(found.expiresAt).getTime() <= Date.now()) return null;
    return found;
  }

  async get(state: string): Promise<GoogleOAuthState | null> {
    return (await this.load()).states.find((item) => item.state === state) ?? null;
  }

  private async load(): Promise<GoogleOAuthStateCollection> {
    try {
      const parsed = JSON.parse(await readFile(this.filePath, "utf8")) as GoogleOAuthStateCollection;
      return parsed.version === "1" && Array.isArray(parsed.states) ? parsed : { version: "1", states: [] };
    } catch {
      return { version: "1", states: [] };
    }
  }

  private async persist(collection: GoogleOAuthStateCollection): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(collection, null, 2), { encoding: "utf8", mode: 0o600 });
    await chmod(this.filePath, 0o600).catch(() => undefined);
  }
}

export class FetchGoogleOAuthHttpClient implements GoogleOAuthHttpClient {
  async exchangeCode(input: GoogleOAuthConfig & { code: string }): Promise<GoogleOAuthTokenResponse> {
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code: input.code,
      client_id: input.clientId,
      client_secret: input.clientSecret,
      redirect_uri: input.redirectUri
    });
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString()
    });
    if (!response.ok) throw new Error(`Google OAuth code exchange failed (${response.status}).`);
    return (await response.json()) as GoogleOAuthTokenResponse;
  }

  async refresh(input: Pick<GoogleOAuthConfig, "clientId" | "clientSecret"> & { refreshToken: string }): Promise<GoogleOAuthTokenResponse> {
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: input.refreshToken,
      client_id: input.clientId,
      client_secret: input.clientSecret
    });
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString()
    });
    if (!response.ok) throw new Error(`Google OAuth token refresh failed (${response.status}).`);
    return (await response.json()) as GoogleOAuthTokenResponse;
  }
}

function accountFromIdToken(idToken?: string): string | undefined {
  if (!idToken) return undefined;
  const [, payload] = idToken.split(".");
  if (!payload) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { email?: string };
    return parsed.email;
  } catch {
    return undefined;
  }
}

export class GoogleOAuthService {
  constructor(
    private readonly config: GoogleOAuthConfig,
    private readonly stateStore: FileGoogleOAuthStateStore,
    private readonly tokenStore: GoogleTokenStore,
    private readonly httpClient: GoogleOAuthHttpClient = new FetchGoogleOAuthHttpClient(),
    private readonly encryptionKey?: string
  ) {}

  async start(request: GoogleOAuthStartRequest): Promise<GoogleOAuthStartResult> {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 10 * 60 * 1000).toISOString();
    await this.stateStore.save({
      state: request.state,
      createdAt: now.toISOString(),
      expiresAt,
      requestedScopes: [...new Set(request.requestedScopes)],
      mode: "native",
      ...(request.accountHint ? { accountHint: request.accountHint } : {})
    });
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      response_type: "code",
      redirect_uri: this.config.redirectUri,
      scope: request.requestedScopes.join(" "),
      access_type: "offline",
      include_granted_scopes: "true",
      prompt: "consent",
      state: request.state
    });
    if (request.accountHint) params.set("login_hint", request.accountHint);
    return {
      authorizationUrl: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
      state: request.state,
      requestedScopes: [...new Set(request.requestedScopes)],
      expiresAt
    };
  }

  async complete(request: GoogleOAuthCallbackRequest): Promise<GoogleOAuthCallbackResult> {
    const state = await this.stateStore.consume(request.state);
    if (!state) throw new Error("OAuth state is invalid, expired, or already used.");
    const tokens = await this.httpClient.exchangeCode({ ...this.config, code: request.code });
    if (!tokens.access_token) throw new Error("Google OAuth did not return an access token.");
    if (!tokens.refresh_token) throw new Error("Google OAuth did not return a refresh token. Reconnect with offline access consent.");
    const grantedScopes = tokens.scope ? tokens.scope.split(/\s+/).filter(Boolean) : state.requestedScopes;
    const encryptionKey = this.encryptionKey ?? await ensureGoogleTokenEncryptionKey();
    const expiryDate = tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000).toISOString() : undefined;
    const account = accountFromIdToken(tokens.id_token) ?? state.accountHint;
    const encrypt = async (token: string) => this.tokenStore instanceof LocalEncryptedGoogleTokenStore
      ? this.tokenStore.encryptToken(token)
      : encryptGoogleToken(token, encryptionKey);
    const now = new Date().toISOString();
    const record: GoogleTokenRecord = {
      id: `google-token:${randomBytes(16).toString("base64url")}`,
      ...(account ? { account } : {}),
      provider: "google",
      accessTokenEncrypted: await encrypt(tokens.access_token),
      refreshTokenEncrypted: await encrypt(tokens.refresh_token),
      ...(tokens.token_type ? { tokenType: tokens.token_type } : {}),
      ...(expiryDate ? { expiryDate } : {}),
      grantedScopes,
      createdAt: now,
      updatedAt: now
    };
    const saved = await this.tokenStore.save(record);
    return {
      ...(saved.account ? { account: saved.account } : {}),
      grantedScopes,
      tokenRecordId: saved.id
    };
  }
}

export function googleOAuthConfigFromEnv(env: NodeJS.ProcessEnv = process.env, redirectUri?: string): GoogleOAuthConfig | null {
  const clientId = env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = env.GOOGLE_OAUTH_CLIENT_SECRET;
  const resolvedRedirectUri = redirectUri ?? env.GOOGLE_OAUTH_REDIRECT_URI ?? "http://localhost:4100/integrations/google/oauth/callback";
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret, redirectUri: resolvedRedirectUri };
}
