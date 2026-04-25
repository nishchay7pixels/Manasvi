import assert from "node:assert/strict";
import test from "node:test";

import { attachEventIntegrity } from "@manasvi/contracts";
import {
  EventConsumer,
  InMemoryDeadLetterStore,
  InMemoryIdempotencyStore
} from "../../../../packages/event-bus/src/index.js";

import { fixtureChannelEvent } from "./fixtures.js";
import { assertEventRejected } from "./oracles.js";

test("[TB-EVENT-001][event-integrity] forged internal event without signature is rejected", async () => {
  const deadLetters = new InMemoryDeadLetterStore();
  const consumer = new EventConsumer({
    deadLetterStore: deadLetters,
    requireSignedInternalEvents: true,
    signingSecretsByKeyId: { "k1": "event-secret" }
  });
  const forgedInternalEvent = fixtureChannelEvent({
    source: {
      sourceType: "service",
      sourceId: "orchestrator-service",
      sourceAuthenticity: {
        verified: false,
        method: "none",
        authnStrength: "weak"
      }
    },
    integrity: {
      algorithm: "sha256",
      payloadHash: "fake"
    }
  });
  const outcome = await consumer.consumeRaw(forgedInternalEvent);
  assertEventRejected(outcome, deadLetters.records, "INTEGRITY_FAILURE");
});

test("[TB-EVENT-001][event-integrity] replayed signed event is deduplicated", async () => {
  const deadLetters = new InMemoryDeadLetterStore();
  const idempotency = new InMemoryIdempotencyStore();
  const consumer = new EventConsumer({
    deadLetterStore: deadLetters,
    idempotencyStore: idempotency,
    requireSignedInternalEvents: false
  });
  let handled = 0;
  consumer.subscribe("ingress.external_message.received", async () => {
    handled += 1;
  });

  const event = attachEventIntegrity(fixtureChannelEvent());
  const first = await consumer.consumeRaw(event);
  const second = await consumer.consumeRaw(event);

  assert.equal(first, "acked");
  assert.equal(second, "duplicate");
  assert.equal(handled, 1);
  assert.equal(deadLetters.records.length, 0);
});

test("[TB-EVENT-001][event-integrity][control] correctly signed internal event is accepted", async () => {
  const deadLetters = new InMemoryDeadLetterStore();
  const consumer = new EventConsumer({
    deadLetterStore: deadLetters,
    requireSignedInternalEvents: true,
    signingSecretsByKeyId: { "k1": "event-secret" }
  });
  let handled = 0;
  consumer.subscribe("ingress.external_message.received", async () => {
    handled += 1;
  });
  const signedInternal = attachEventIntegrity(
    fixtureChannelEvent({
      source: {
        sourceType: "service",
        sourceId: "ingress-service",
        sourceAuthenticity: {
          verified: true,
          method: "internal-auth",
          authnStrength: "strong"
        }
      }
    }),
    {
      keyId: "k1",
      secret: "event-secret"
    }
  );
  const outcome = await consumer.consumeRaw(signedInternal);
  assert.equal(outcome, "acked");
  assert.equal(handled, 1);
});
