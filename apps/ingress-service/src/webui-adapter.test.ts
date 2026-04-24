import assert from "node:assert/strict";
import test from "node:test";

import { parseLegacyIngressEvent, parseWebUiMessage } from "./webui-adapter.js";

test("web ui adapter parses authenticated request with untrusted raw inbound stance", () => {
  const parsed = parseWebUiMessage({
    body: {
      tenantId: "tenant-local",
      workspaceId: "workspace-local",
      actorPrincipalId: "user:alice",
      actorPrincipalType: "human_user",
      channelPrincipalId: "channel:webui",
      message: "hello"
    },
    authenticated: true,
    serviceName: "ingress-service",
    traceId: "trace",
    correlationId: "corr"
  });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) {
    return;
  }
  assert.equal(parsed.normalized.actor.principalId, "user:alice");
  assert.equal(parsed.normalized.source.authenticity.verified, true);
  assert.equal(parsed.normalized.source.authenticity.method, "internal-auth");
});

test("web ui adapter rejects invalid payload", () => {
  const parsed = parseWebUiMessage({
    body: { nope: true },
    authenticated: true,
    serviceName: "ingress-service",
    traceId: "trace",
    correlationId: "corr"
  });
  assert.equal(parsed.ok, false);
  if (parsed.ok) {
    return;
  }
  assert.equal(parsed.statusCode, 400);
});

test("legacy ingress adapter preserves actor/channel mapping", () => {
  const parsed = parseLegacyIngressEvent({
    body: {
      tenantId: "tenant-local",
      workspaceId: "workspace-local",
      actor: { principalType: "human_user", principalId: "user:alice" },
      channel: { principalType: "channel", principalId: "channel:dev-cli", messageId: "msg:1" },
      text: "ping",
      metadata: {}
    },
    authenticated: true,
    serviceName: "ingress-service"
  });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) {
    return;
  }
  assert.equal(parsed.normalized.channel.principalId, "channel:dev-cli");
  assert.equal(parsed.normalized.source.sourceType, "service");
});
