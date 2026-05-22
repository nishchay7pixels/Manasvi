import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import {
  CalendarNativeClient,
  createGoogleTokenRecord,
  executeGoogleCapability,
  FileGoogleOAuthStateStore,
  generateGoogleOAuthState,
  getMissingScopes,
  getRequiredScopesForCapability,
  GmailNativeClient,
  GoogleOAuthService,
  hasRequiredScopes,
  listScopesByService,
  LocalEncryptedGoogleTokenStore,
  NativeGoogleProvider,
  type GoogleOAuthHttpClient,
  type NativeGoogleApiClient
} from "./index.js";
import { createGoogleIntegrationConfigForMode, normalizeGoogleIntegrationConfig } from "./google-config.js";
import { GogGoogleProvider } from "./providers/gog-google-provider.js";

class FakeGoogleApiClient implements NativeGoogleApiClient {
  calls: Array<{ method: string; url: string; body?: unknown }> = [];

  async get<T>(url: string): Promise<T> {
    this.calls.push({ method: "GET", url });
    if (url.includes("/messages?")) return { messages: [{ id: "m1" }] } as T;
    if (url.includes("/messages/m1")) return {
      id: "m1",
      threadId: "t1",
      snippet: "hello",
      internalDate: "1710000000000",
      payload: {
        headers: [
          { name: "From", value: "alice@example.com" },
          { name: "To", value: "bob@example.com" },
          { name: "Subject", value: "Hi" }
        ],
        body: { data: Buffer.from("body", "utf8").toString("base64url") }
      }
    } as T;
    if (url.includes("/threads/")) return { messages: [{ id: "m1", threadId: "t1", payload: { body: { data: Buffer.from("body", "utf8").toString("base64url") } } }] } as T;
    if (url.includes("/events?")) return { items: [{ id: "e1", summary: "Meet", start: { dateTime: "2026-05-23T10:00:00Z" }, end: { dateTime: "2026-05-23T11:00:00Z" } }] } as T;
    throw new Error(`unexpected GET ${url}`);
  }

  async post<T>(url: string, body: unknown): Promise<T> {
    this.calls.push({ method: "POST", url, body });
    if (url.includes("/drafts")) return { id: "d1", message: { id: "m1", threadId: "t1" } } as T;
    if (url.includes("/messages/send")) return { id: "m2", threadId: "t1", labelIds: ["SENT"] } as T;
    if (url.includes("/events")) return { id: "e2", summary: "Created", start: { dateTime: "2026-05-23T10:00:00Z" }, end: { dateTime: "2026-05-23T11:00:00Z" } } as T;
    throw new Error(`unexpected POST ${url}`);
  }

  async patch<T>(url: string, body: unknown): Promise<T> {
    this.calls.push({ method: "PATCH", url, body });
    return { id: "e1", summary: "Updated", start: { dateTime: "2026-05-23T10:00:00Z" }, end: { dateTime: "2026-05-23T11:00:00Z" } } as T;
  }

  async delete(url: string): Promise<void> {
    this.calls.push({ method: "DELETE", url });
  }
}

async function tokenStore(scopes: string[], expiryDate?: string) {
  const dir = await mkdtemp(join(tmpdir(), "manasvi-native-"));
  const store = new LocalEncryptedGoogleTokenStore({ filePath: join(dir, "tokens.json"), encryptionKey: "test-key" });
  await store.save(createGoogleTokenRecord({
    account: "user@example.com",
    accessToken: "access-token",
    refreshToken: "refresh-token",
    ...(expiryDate ? { expiryDate } : {}),
    grantedScopes: scopes,
    encryptionKey: "test-key"
  }));
  return { store, dir };
}

test("scope registry returns required and missing scopes", () => {
  assert.deepEqual(getRequiredScopesForCapability("google.gmail.search"), ["https://www.googleapis.com/auth/gmail.readonly"]);
  assert.equal(hasRequiredScopes("google.gmail.search", ["https://www.googleapis.com/auth/gmail.readonly"]), true);
  assert.deepEqual(getMissingScopes("google.gmail.send", ["https://www.googleapis.com/auth/gmail.readonly"]), ["https://www.googleapis.com/auth/gmail.send"]);
  assert.ok(listScopesByService("calendar").includes("https://www.googleapis.com/auth/calendar.events"));
  assert.throws(() => getRequiredScopesForCapability("google.raw"));
});

test("OAuth start stores one-time state and complete stores encrypted token", async () => {
  const dir = await mkdtemp(join(tmpdir(), "manasvi-oauth-"));
  const states = new FileGoogleOAuthStateStore(join(dir, "states.json"));
  const store = new LocalEncryptedGoogleTokenStore({ filePath: join(dir, "tokens.json"), encryptionKey: "test-key" });
  const state = generateGoogleOAuthState();
  const http: GoogleOAuthHttpClient = {
    exchangeCode: async () => ({
      access_token: "access-token",
      refresh_token: "refresh-token",
      expires_in: 3600,
      token_type: "Bearer",
      scope: "https://www.googleapis.com/auth/gmail.readonly"
    }),
    refresh: async () => ({ access_token: "new-token" })
  };
  const service = new GoogleOAuthService(
    { clientId: "client", clientSecret: "secret", redirectUri: "http://localhost/callback" },
    states,
    store,
    http
  );
  const started = await service.start({ state, requestedScopes: ["https://www.googleapis.com/auth/gmail.readonly"] });
  assert.ok(started.authorizationUrl.includes("include_granted_scopes=true"));
  assert.ok(started.authorizationUrl.includes(`state=${encodeURIComponent(state)}`));

  const completed = await service.complete({ code: "code", state });
  assert.equal(completed.grantedScopes[0], "https://www.googleapis.com/auth/gmail.readonly");
  const saved = await store.getDefault();
  assert.ok(saved?.accessTokenEncrypted);
  assert.ok(saved.refreshTokenEncrypted);
  assert.ok(!(await readFile(join(dir, "tokens.json"), "utf8")).includes("access-token"));
  await assert.rejects(() => service.complete({ code: "code", state }), /invalid, expired, or already used/);
});

test("token store saves and redacts token records", async () => {
  const { store } = await tokenStore(["https://www.googleapis.com/auth/gmail.readonly"]);
  const record = await store.getByAccount("user@example.com");
  assert.ok(record);
  assert.equal(await store.decryptAccessToken(record!), "access-token");
  assert.ok(!JSON.stringify(record).includes("access-token"));
});

test("native Gmail and Calendar clients normalize results", async () => {
  const api = new FakeGoogleApiClient();
  const gmail = new GmailNativeClient(api);
  const search = await gmail.search("token", { query: "in:inbox", limit: 1 });
  assert.equal(search.messages[0]?.id, "m1");
  const message = await gmail.read("token", { messageId: "m1" });
  assert.equal(message.text, "body");
  const calendar = new CalendarNativeClient(api);
  const list = await calendar.list("token", { timeMin: "2026-05-23", limit: 1 });
  assert.equal(list.events[0]?.id, "e1");
});

test("NativeGoogleProvider health and execution enforce scopes and approval", async () => {
  const api = new FakeGoogleApiClient();
  const { store } = await tokenStore(["https://www.googleapis.com/auth/gmail.readonly", "https://www.googleapis.com/auth/calendar.readonly"]);
  const provider = new NativeGoogleProvider({
    oauthConfig: { clientId: "client", clientSecret: "secret", redirectUri: "http://localhost/callback" },
    tokenStore: store,
    tokenEncryptionKey: "test-key",
    apiClient: api
  });
  const health = await provider.healthCheck();
  assert.equal(health.status, "available");
  const result = await provider.execute({ capabilityId: "google.gmail.search", input: { query: "in:inbox" }, correlationId: "corr" });
  assert.equal(result.status, "completed");
  assert.equal(result.audit?.backend, "native");
  assert.equal(result.audit?.executed, true);

  const missing = await provider.execute({ capabilityId: "google.gmail.send", input: { to: ["a@example.com"], subject: "Hi", bodyText: "Body" }, approval: { approved: true, approvalId: "a1" } });
  assert.equal(missing.status, "missing_scope");

  const { store: writeStore } = await tokenStore(["https://www.googleapis.com/auth/gmail.send"]);
  const writeProvider = new NativeGoogleProvider({
    oauthConfig: { clientId: "client", clientSecret: "secret", redirectUri: "http://localhost/callback" },
    tokenStore: writeStore,
    tokenEncryptionKey: "test-key",
    apiClient: api
  });
  const blocked = await writeProvider.execute({ capabilityId: "google.gmail.send", input: { to: ["a@example.com"], subject: "Hi", bodyText: "Body" }, approval: { approved: true, approvalId: "a1" } });
  assert.equal(blocked.status, "blocked");
  assert.equal(blocked.audit?.blockedReason, "approval_verification_unavailable");
});

test("native provider refreshes expired access token", async () => {
  const api = new FakeGoogleApiClient();
  const { store } = await tokenStore(["https://www.googleapis.com/auth/gmail.readonly"], "2020-01-01T00:00:00.000Z");
  const provider = new NativeGoogleProvider({
    oauthConfig: { clientId: "client", clientSecret: "secret", redirectUri: "http://localhost/callback" },
    tokenStore: store,
    tokenEncryptionKey: "test-key",
    apiClient: api,
    oauthHttpClient: {
      exchangeCode: async () => ({ access_token: "unused" }),
      refresh: async () => ({ access_token: "refreshed-token", expires_in: 3600 })
    }
  });
  const result = await provider.execute({ capabilityId: "google.gmail.search", input: { query: "in:inbox" } });
  assert.equal(result.status, "completed");
  const saved = await store.getDefault();
  assert.equal(await store.decryptAccessToken(saved!), "refreshed-token");
});

test("router routes native and mixed modes without silent fallback", async () => {
  const { store } = await tokenStore(["https://www.googleapis.com/auth/gmail.readonly"]);
  const native = new NativeGoogleProvider({
    oauthConfig: { clientId: "client", clientSecret: "secret", redirectUri: "http://localhost/callback" },
    tokenStore: store,
    tokenEncryptionKey: "test-key",
    apiClient: new FakeGoogleApiClient()
  });
  const config = normalizeGoogleIntegrationConfig({
    ...createGoogleIntegrationConfigForMode("mixed"),
    enabled: true,
    services: {
      gmail: { enabled: true, backend: "native", read: true, write: false }
    }
  });
  const result = await executeGoogleCapability(
    { capabilityId: "google.gmail.search", input: { query: "in:inbox" } },
    { config, providers: { native, gog: new GogGoogleProvider() } }
  );
  assert.equal(result.provider, "native");
  assert.equal(result.status, "completed");
  assert.equal(result.audit?.providerAudit && typeof result.audit.providerAudit, "object");
});
