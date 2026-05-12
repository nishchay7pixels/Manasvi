import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  ConnectorRegistry,
  EncryptedTokenVault,
  GOOGLE_PROVIDER_PROFILE,
  IntegrationAccountStore,
  OAuthFlowService,
  OAuthStateStore,
  createGoogleConnector,
  type OAuthClient
} from "./index.js";

class MockOAuthClient implements OAuthClient {
  async exchangeCode() {
    return { accessToken: "access-1", refreshToken: "refresh-1", expiresIn: 3600, tokenType: "Bearer" };
  }
  async refreshToken() {
    return { accessToken: "access-2", expiresIn: 1200, tokenType: "Bearer" };
  }
  async revokeToken() {}
}

async function buildFixture() {
  const root = await mkdtemp(join(tmpdir(), "manasvi-g1-"));
  const registry = new ConnectorRegistry();
  registry.register(createGoogleConnector());
  const stateStore = new OAuthStateStore(join(root, "oauth-states.json"));
  const accountStore = new IntegrationAccountStore(join(root, "accounts.json"));
  const tokenVault = new EncryptedTokenVault(join(root, "tokens.json"), "test-encryption-secret");

  const flow = new OAuthFlowService({
    connectorRegistry: registry,
    stateStore,
    accountStore,
    tokenVault,
    oauthClient: new MockOAuthClient(),
    providerProfile: GOOGLE_PROVIDER_PROFILE,
    clientId: "client-id",
    clientSecret: "client-secret",
    defaultRedirectUri: "http://localhost:4100/integrations/oauth/google/callback"
  });

  return { flow, stateStore, accountStore, tokenVault, registry };
}

test("registry registers and lists google connector", async () => {
  const { registry } = await buildFixture();
  const items = registry.list();
  assert.equal(items.length, 1);
  assert.equal(items[0]?.providerId, "google");
});

test("oauth state is generated and consumed once", async () => {
  const { stateStore } = await buildFixture();
  const issued = await stateStore.create({
    providerId: "google",
    connectorId: "google-foundation",
    redirectUri: "http://localhost:4100/integrations/oauth/google/callback",
    scopes: ["openid"],
    ttlSeconds: 300
  });
  const first = await stateStore.consume(issued.state);
  const second = await stateStore.consume(issued.state);
  assert.ok(first);
  assert.equal(second, null);
});

test("callback success stores encrypted references and connected status", async () => {
  const { flow, accountStore, tokenVault } = await buildFixture();
  const started = await flow.startGoogleFlow({ scopes: ["openid", "email"] });
  const state = new URL(started.authorizeUrl).searchParams.get("state");
  assert.ok(state);

  const record = await flow.completeGoogleCallback({ state: state!, code: "code-1" });
  assert.equal(record.status, "connected");
  assert.ok(record.tokenReference);
  assert.ok(record.refreshTokenReference);

  const token = await tokenVault.get(record.tokenReference!);
  assert.equal(token?.accessToken, "access-1");

  const fetched = await accountStore.getByProvider("google");
  assert.equal(fetched?.accountId, record.accountId);
});

test("callback fails on invalid state", async () => {
  const { flow } = await buildFixture();
  await assert.rejects(() => flow.completeGoogleCallback({ state: "invalid", code: "code" }));
});

test("refresh updates account status and token material", async () => {
  const { flow, accountStore, tokenVault } = await buildFixture();
  const started = await flow.startGoogleFlow({ scopes: ["openid"] });
  const state = new URL(started.authorizeUrl).searchParams.get("state")!;
  const account = await flow.completeGoogleCallback({ state, code: "code-2" });

  const refreshed = await flow.refreshGoogle(account);
  assert.equal(refreshed.status, "connected");
  assert.ok(refreshed.lastRefreshAt);
  const token = await tokenVault.get(refreshed.tokenReference!);
  assert.equal(token?.accessToken, "access-2");

  const stored = await accountStore.getByProvider("google");
  assert.equal(stored?.status, "connected");
});

test("disconnect revokes and removes token references", async () => {
  const { flow, tokenVault } = await buildFixture();
  const started = await flow.startGoogleFlow({ scopes: ["openid"] });
  const state = new URL(started.authorizeUrl).searchParams.get("state")!;
  const account = await flow.completeGoogleCallback({ state, code: "code-3" });

  const disconnected = await flow.disconnectGoogle(account);
  assert.equal(disconnected.status, "disconnected");
  if (account.tokenReference) {
    const token = await tokenVault.get(account.tokenReference);
    assert.equal(token, null);
  }
});
