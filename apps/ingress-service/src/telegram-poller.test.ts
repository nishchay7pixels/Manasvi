import assert from "node:assert/strict";
import test from "node:test";

import { TelegramPoller } from "./telegram-poller.js";

// ── helpers ───────────────────────────────────────────────────────────────────

function makePoller(overrides: Partial<{ longPollTimeoutSeconds: number }> = {}): TelegramPoller {
  return new TelegramPoller({
    botToken: "test-token",
    apiBaseUrl: "https://api.telegram.org",
    longPollTimeoutSeconds: overrides.longPollTimeoutSeconds ?? 1,
    tenantId: "tenant-local",
    workspaceId: "workspace-local"
  });
}

// ── tests ─────────────────────────────────────────────────────────────────────

test("TelegramPoller initial status reports not running", () => {
  const poller = makePoller();
  const status = poller.getStatus();
  assert.equal(status.running, false);
  assert.equal(status.updatesReceived, 0);
  assert.equal(status.offset, 0);
  assert.equal(status.lastPollAt, null);
  assert.equal(status.lastError, null);
  assert.equal(status.consecutiveErrors, 0);
  assert.equal(status.mode, "polling");
});

test("TelegramPoller stop() is safe to call before start()", async () => {
  const poller = makePoller();
  // Should not throw
  await poller.stop();
  assert.equal(poller.getStatus().running, false);
});

test("TelegramPoller getStatus() returns a snapshot, not a live reference", () => {
  const poller = makePoller();
  const s1 = poller.getStatus();
  const s2 = poller.getStatus();
  // Independent objects
  assert.notStrictEqual(s1, s2);
  assert.deepEqual(s1, s2);
});

test("TelegramPoller advances offset when update_id is present", async () => {
  // Simulate two update batches followed by empty, then stop
  let callCount = 0;
  const updates = [
    [{ update_id: 100, message: { text: "hi" } }],
    [{ update_id: 101, message: { text: "there" } }],
    []
  ];

  const originalFetch = globalThis.fetch;
  let handledCount = 0;

  try {
    globalThis.fetch = (async () => {
      const batch = updates[callCount] ?? [];
      callCount++;
      return {
        ok: true,
        json: async () => ({ ok: true, result: batch })
      } as unknown as Response;
    }) as typeof fetch;

    const poller = makePoller({ longPollTimeoutSeconds: 0 });

    poller.start(async (_update, _trace) => {
      handledCount++;
    });

    // Let the loop run through the three batches
    await new Promise<void>((resolve) => setTimeout(resolve, 150));
    await poller.stop();

    // Should have processed updates from batch 0 and batch 1
    assert.ok(handledCount >= 2, `expected ≥2 handled updates, got ${handledCount}`);
    assert.ok(poller.getStatus().offset >= 102, `expected offset ≥102, got ${poller.getStatus().offset}`);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("TelegramPoller increments consecutiveErrors on Telegram API failure", async () => {
  const originalFetch = globalThis.fetch;
  let errorsInjected = 0;

  try {
    globalThis.fetch = (async () => {
      errorsInjected++;
      return {
        ok: false,
        status: 401,
        text: async () => "Unauthorized"
      } as unknown as Response;
    }) as typeof fetch;

    const poller = makePoller({ longPollTimeoutSeconds: 0 });
    poller.start(async () => {});

    // Wait just long enough for one or two error cycles plus backoff
    await new Promise<void>((resolve) => setTimeout(resolve, 200));
    await poller.stop();

    const status = poller.getStatus();
    assert.ok(status.consecutiveErrors >= 1, `expected ≥1 consecutive errors, got ${status.consecutiveErrors}`);
    assert.ok(status.lastError !== null, "expected lastError to be set");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("TelegramPoller stop() cancels in-flight backoff sleep", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async () => {
      return {
        ok: false,
        status: 500,
        text: async () => "error"
      } as unknown as Response;
    }) as typeof fetch;

    const poller = makePoller({ longPollTimeoutSeconds: 0 });
    poller.start(async () => {});

    // Allow one failed poll cycle to enter backoff sleep, then stop.
    await new Promise<void>((resolve) => setTimeout(resolve, 80));
    await poller.stop();
    await new Promise<void>((resolve) => setTimeout(resolve, 20));

    assert.equal(poller.getStatus().running, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("TelegramPoller does not replay updates with same update_id", async () => {
  // Same update_id every time — handler should only be called once per unique update
  const originalFetch = globalThis.fetch;
  let callCount = 0;
  let handledCount = 0;

  try {
    globalThis.fetch = (async () => {
      callCount++;
      if (callCount === 1) {
        // First call: return one update
        return {
          ok: true,
          json: async () => ({ ok: true, result: [{ update_id: 200, message: { text: "once" } }] })
        } as unknown as Response;
      }
      // Subsequent calls: return empty (offset advanced past 200)
      return {
        ok: true,
        json: async () => ({ ok: true, result: [] })
      } as unknown as Response;
    }) as typeof fetch;

    const poller = makePoller({ longPollTimeoutSeconds: 0 });
    poller.start(async () => {
      handledCount++;
    });

    await new Promise<void>((resolve) => setTimeout(resolve, 150));
    await poller.stop();

    // Update 200 should only be handled once
    assert.equal(handledCount, 1, `expected exactly 1 handled update, got ${handledCount}`);
    assert.equal(poller.getStatus().offset, 201);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
