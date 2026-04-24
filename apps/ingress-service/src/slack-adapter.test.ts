import assert from "node:assert/strict";
import test from "node:test";
import { createHmac } from "node:crypto";

import { parseSlackEvent, verifySlackSignature } from "./slack-adapter.js";

test("verifySlackSignature validates signed payload", () => {
  const secret = "slack-secret";
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const rawBody = JSON.stringify({ type: "event_callback" });
  const base = `v0:${timestamp}:${rawBody}`;
  const signature = `v0=${createHmac("sha256", secret).update(base).digest("hex")}`;
  const result = verifySlackSignature({
    rawBody,
    timestampHeader: timestamp,
    signatureHeader: signature,
    signingSecret: secret
  });
  assert.equal(result.ok, true);
});

test("parseSlackEvent normalizes message event when signature is verified", () => {
  const parsed = parseSlackEvent({
    body: {
      type: "event_callback",
      team_id: "T123",
      event_id: "Ev123",
      event: {
        type: "message",
        user: "U123",
        text: "hello from slack",
        channel: "C123",
        ts: "1711111111.1234"
      }
    },
    serviceName: "ingress-service",
    signatureVerified: true
  });
  assert.equal("challengeResponse" in parsed, false);
  if ("challengeResponse" in parsed || !parsed.ok) {
    return;
  }
  assert.equal(parsed.normalized.actor.principalId, "slack-user:U123");
  assert.equal(parsed.normalized.channel.principalId, "slack-channel:C123");
});

test("parseSlackEvent rejects when signature verification failed", () => {
  const parsed = parseSlackEvent({
    body: {
      type: "event_callback",
      event: {
        type: "message",
        user: "U123",
        text: "hello",
        channel: "C123",
        ts: "1711111111.1234"
      }
    },
    serviceName: "ingress-service",
    signatureVerified: false,
    signatureFailureReason: "SLACK_SIGNATURE_MISMATCH"
  });
  assert.equal("challengeResponse" in parsed, false);
  if ("challengeResponse" in parsed || parsed.ok) {
    return;
  }
  assert.equal(parsed.statusCode, 401);
});
