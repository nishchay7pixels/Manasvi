import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import {
  createCanonicalEvent,
  parseCanonicalEvent,
  verifyEventIntegrity,
  EVENT_ENVELOPE_VERSION
} from "./index.js";

const baseInput = {
  eventType: "ingress.external_message.received" as const,
  tenantId: "tenant-a",
  workspaceId: "workspace-a",
  actor: { principalType: "human_user" as const, principalId: "user-1" },
  channel: { principalType: "channel" as const, principalId: "slack:C1" },
  source: {
    sourceType: "channel" as const,
    sourceId: "slack",
    sourceAuthenticity: { verified: true, method: "signature" as const, authnStrength: "strong" as const }
  },
  trace: {
    traceId: randomUUID(),
    correlationId: randomUUID()
  },
  payload: {
    payloadSchemaVersion: "1.0" as const,
    channelMessageId: "m-1",
    text: "hello",
    metadata: {}
  },
  trustClassification: "EXTERNAL_UNTRUSTED" as const,
  risk: { level: "medium" as const, reasons: ["external_input"] },
  idempotencyKey: "idem-1",
  producer: {
    serviceName: "ingress-service" as const,
    serviceVersion: "0.1.0",
    environment: "local" as const
  }
};

test("valid canonical event creation and parse", () => {
  const event = createCanonicalEvent(baseInput);
  const parsed = parseCanonicalEvent(event);
  assert.equal(parsed.envelopeVersion, EVENT_ENVELOPE_VERSION);
  assert.equal(parsed.eventType, "ingress.external_message.received");
  assert.equal(parsed.trust.classification, "EXTERNAL_UNTRUSTED");
});

test("unknown envelope version is rejected", () => {
  const event = createCanonicalEvent(baseInput) as Record<string, unknown>;
  event.envelopeVersion = "9.9";
  assert.throws(() => parseCanonicalEvent(event), /Invalid canonical event envelope/);
});

test("missing required metadata is rejected", () => {
  const event = createCanonicalEvent(baseInput) as Record<string, unknown>;
  delete event.tenantId;
  assert.throws(() => parseCanonicalEvent(event), /Invalid canonical event envelope/);
});

test("integrity failure is detected", () => {
  const event = createCanonicalEvent(baseInput);
  (event.payload as { text: string }).text = "tampered";
  const result = verifyEventIntegrity(event, { requiredForInternal: false });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, "HASH_MISMATCH");
  }
});
