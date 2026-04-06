import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { createCanonicalEvent } from "@manasvi/contracts";

import {
  EventConsumer,
  EventPublisher,
  InMemoryDeadLetterStore,
  InMemoryTransport,
  RetryableError,
  TerminalHandlerError,
  connectInMemory
} from "./index.js";

function buildEvent() {
  return createCanonicalEvent({
    eventType: "ingress.external_message.received",
    tenantId: "tenant-1",
    workspaceId: "workspace-1",
    actor: { principalType: "human_user", principalId: "user-1" },
    channel: { principalType: "channel", principalId: "slack:C1" },
    source: {
      sourceType: "channel",
      sourceId: "slack",
      sourceAuthenticity: {
        verified: true,
        method: "signature",
        authnStrength: "strong"
      }
    },
    trace: {
      traceId: randomUUID(),
      correlationId: randomUUID()
    },
    payload: {
      payloadSchemaVersion: "1.0",
      channelMessageId: "msg-1",
      text: "hello",
      metadata: {}
    },
    trustClassification: "EXTERNAL_UNTRUSTED",
    risk: {
      level: "medium",
      reasons: ["external_input"]
    },
    idempotencyKey: "idem-1",
    producer: {
      serviceName: "ingress-service",
      serviceVersion: "0.1.0",
      environment: "local"
    }
  });
}

test("publish/subscribe happy path", async () => {
  const dead = new InMemoryDeadLetterStore();
  const transport = new InMemoryTransport();
  const consumer = new EventConsumer({
    deadLetterStore: dead,
    requireSignedInternalEvents: false
  });
  let received = 0;
  consumer.subscribe("ingress.external_message.received", async () => {
    received += 1;
  });
  connectInMemory(transport, consumer);

  const publisher = new EventPublisher({ transport });
  await publisher.publish(buildEvent());

  assert.equal(received, 1);
  assert.equal(dead.records.length, 0);
});

test("duplicate delivery is survivable", async () => {
  const dead = new InMemoryDeadLetterStore();
  const consumer = new EventConsumer({
    deadLetterStore: dead,
    requireSignedInternalEvents: false
  });
  let received = 0;
  consumer.subscribe("ingress.external_message.received", async () => {
    received += 1;
  });
  const event = buildEvent();
  const first = await consumer.consumeRaw(event);
  const second = await consumer.consumeRaw(event);

  assert.equal(first, "acked");
  assert.equal(second, "duplicate");
  assert.equal(received, 1);
});

test("retry then ack on transient failure", async () => {
  const dead = new InMemoryDeadLetterStore();
  const consumer = new EventConsumer({
    deadLetterStore: dead,
    maxAttempts: 3,
    requireSignedInternalEvents: false
  });
  let attempts = 0;
  consumer.subscribe("ingress.external_message.received", async () => {
    attempts += 1;
    if (attempts < 2) {
      throw new RetryableError("temporary");
    }
  });

  const result = await consumer.consumeRaw(buildEvent());
  assert.equal(result, "acked");
  assert.equal(attempts, 2);
  assert.equal(dead.records.length, 0);
});

test("dead-letter on terminal failure", async () => {
  const dead = new InMemoryDeadLetterStore();
  const consumer = new EventConsumer({
    deadLetterStore: dead,
    maxAttempts: 3,
    requireSignedInternalEvents: false
  });
  consumer.subscribe("ingress.external_message.received", async () => {
    throw new TerminalHandlerError("bad payload");
  });

  const result = await consumer.consumeRaw(buildEvent());
  assert.equal(result, "dead-lettered");
  assert.equal(dead.records.length, 1);
  assert.equal(dead.records[0]?.reasonCode, "HANDLER_TERMINAL_ERROR");
});

test("dead-letter on integrity failure", async () => {
  const dead = new InMemoryDeadLetterStore();
  const consumer = new EventConsumer({
    deadLetterStore: dead,
    requireSignedInternalEvents: false
  });
  const event = buildEvent();
  (event.payload as { text: string }).text = "tampered";
  const result = await consumer.consumeRaw(event);
  assert.equal(result, "dead-lettered");
  assert.equal(dead.records[0]?.reasonCode, "INTEGRITY_FAILURE");
});

test("invalid raw event goes to dead-letter", async () => {
  const dead = new InMemoryDeadLetterStore();
  const consumer = new EventConsumer({
    deadLetterStore: dead
  });
  const result = await consumer.consumeRaw({ foo: "bar" });
  assert.equal(result, "dead-lettered");
  assert.equal(dead.records[0]?.reasonCode, "INVALID_SCHEMA");
});
