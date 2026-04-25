import assert from "node:assert/strict";
import test from "node:test";

import {
  createSecretAccessGrant,
  createSecretAccessRequest,
  secretReferenceSchema,
  secretReferenceStringSchema,
  secretUsageRecordSchema
} from "./secrets.js";

test("secret reference string supports legacy and uri formats", () => {
  assert.equal(secretReferenceStringSchema.safeParse("secret:telegram/bot-token").success, true);
  assert.equal(secretReferenceStringSchema.safeParse("secret://tenant/acme/telegram/bot-token").success, true);
  assert.equal(secretReferenceStringSchema.safeParse("telegram-token").success, false);
});

test("secret reference schema captures metadata without raw value", () => {
  const parsed = secretReferenceSchema.parse({
    schemaVersion: "1.0",
    reference: "secret://tenant/acme/telegram/bot-token",
    provider: "env-map",
    category: "channel_credential",
    allowedConsumerTypes: ["adapter-runtime"],
    tags: ["telegram"]
  });
  assert.equal(parsed.reference.includes("token"), true);
});

test("secret access request/grant are strongly typed", () => {
  const request = createSecretAccessRequest({
    reference: "secret:demo",
    consumerType: "tool-runtime",
    consumerId: "tool:http_fetch",
    purpose: "runtime_execution",
    actor: { principalId: "user:alice", principalType: "human_user" },
    caller: { principalId: "service:execution-manager", principalType: "service" },
    tenantId: "tenant-local",
    workspaceId: "workspace-local",
    trace: {
      traceId: "30af0835-20f7-4853-a4cf-f97b95fa915f",
      correlationId: "f049a9ae-ec59-4b8a-ae2d-d8edba32de8d"
    },
    rawValueExposureRequested: false
  });
  const grant = createSecretAccessGrant({
    requestId: request.requestId,
    reference: request.reference,
    approved: true,
    trace: request.trace,
    reasonCodes: ["policy_allow"],
    rawValueExposureAllowed: false
  });
  assert.equal(grant.approved, true);
  assert.equal(grant.rawValueExposureAllowed, false);
});

test("secret usage record never requires raw secret values", () => {
  const parsed = secretUsageRecordSchema.parse({
    schemaVersion: "1.0",
    usageId: "usage:1",
    eventType: "secret.injected",
    timestamp: new Date().toISOString(),
    reference: "secret:demo",
    consumerType: "tool-runtime",
    consumerId: "tool:http_fetch",
    trace: {
      traceId: "7c6adf06-c120-453f-bf08-d2668d7d0706",
      correlationId: "c89b68be-cf87-4f0f-b398-02fc4f0b8208"
    },
    metadata: { injectedEnvName: "MANASVI_SECRET_SECRET_DEMO" }
  });
  assert.equal("value" in parsed.metadata, false);
});

