import assert from "node:assert/strict";
import test from "node:test";

import { InMemoryDuplicateGuard, InMemoryRateLimiter } from "./edge-controls.js";

test("rate limiter blocks requests above threshold within window", () => {
  const limiter = new InMemoryRateLimiter(2, 1000);
  const now = 1_000;
  assert.equal(limiter.evaluate("k", now).allowed, true);
  assert.equal(limiter.evaluate("k", now + 10).allowed, true);
  const blocked = limiter.evaluate("k", now + 20);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.retryAfterMs > 0, true);
});

test("rate limiter resets after window", () => {
  const limiter = new InMemoryRateLimiter(1, 1000);
  const now = 1_000;
  assert.equal(limiter.evaluate("k", now).allowed, true);
  assert.equal(limiter.evaluate("k", now + 100).allowed, false);
  assert.equal(limiter.evaluate("k", now + 1_001).allowed, true);
});

test("duplicate guard suppresses repeated keys within ttl", () => {
  const guard = new InMemoryDuplicateGuard(500);
  const now = 1_000;
  assert.equal(guard.markOrReject("dup", now), true);
  assert.equal(guard.markOrReject("dup", now + 200), false);
  assert.equal(guard.markOrReject("dup", now + 600), true);
});
