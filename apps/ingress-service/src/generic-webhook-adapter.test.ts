import assert from "node:assert/strict";
import test from "node:test";

import { parseGenericWebhook } from "./generic-webhook-adapter.js";

test("generic webhook accepts request when shared secret matches", () => {
  const parsed = parseGenericWebhook({
    body: {
      tenantId: "tenant-local",
      workspaceId: "workspace-local",
      sourceId: "ci-system",
      text: "hello"
    },
    sharedSecret: "s3cret",
    providedSecret: "s3cret",
    serviceName: "ingress-service"
  });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) {
    return;
  }
  assert.equal(parsed.normalized.source.authenticity.verified, true);
  assert.equal(parsed.normalized.source.authenticity.method, "signature");
});

test("generic webhook rejects when shared secret mismatches", () => {
  const parsed = parseGenericWebhook({
    body: {
      tenantId: "tenant-local",
      workspaceId: "workspace-local",
      sourceId: "ci-system",
      text: "hello"
    },
    sharedSecret: "s3cret",
    providedSecret: "wrong",
    serviceName: "ingress-service"
  });
  assert.equal(parsed.ok, false);
  if (parsed.ok) {
    return;
  }
  assert.equal(parsed.statusCode, 401);
  assert.equal(parsed.reason, "GENERIC_WEBHOOK_SECRET_MISMATCH");
});
