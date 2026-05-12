import assert from "node:assert/strict";
import test from "node:test";

import {
  DelayedAckManager,
  detectWorkflowType,
  type AckLogger,
  type DelayedAckConfig
} from "./delayed-ack-manager.js";

// ── Test helpers ─────────────────────────────────────────────────────────────

const nullLogger: AckLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {}
};

/**
 * Builds a controllable fake timer.
 * Call `fire()` to synchronously invoke the most recently registered callback.
 * The `handle` returned from `set()` is a simple incrementing number cast to the
 * required timer type; `clear()` marks it as cancelled so `fire()` becomes a no-op.
 */
function makeFakeTimer() {
  let nextId = 1;
  let pending: { id: number; fn: () => void } | null = null;

  return {
    set(fn: () => void, _ms: number): ReturnType<typeof setTimeout> {
      const id = nextId++;
      pending = { id, fn };
      return id as unknown as ReturnType<typeof setTimeout>;
    },
    clear(handle: ReturnType<typeof setTimeout>): void {
      if (pending && pending.id === (handle as unknown as number)) {
        pending = null;
      }
    },
    fire(): void {
      if (pending) {
        const fn = pending.fn;
        pending = null;
        fn();
      }
    },
    hasPending(): boolean {
      return pending !== null;
    }
  };
}

function makeManager(
  overrides: Partial<DelayedAckConfig> = {},
  timer = makeFakeTimer()
): { manager: DelayedAckManager; timer: ReturnType<typeof makeFakeTimer> } {
  const config: DelayedAckConfig = {
    enabled: true,
    ackDelayMs: 2000,
    contextualAckEnabled: true,
    ...overrides
  };
  const manager = new DelayedAckManager(config, nullLogger, {
    set: timer.set,
    clear: timer.clear
  });
  return { manager, timer };
}

// ── Core timer behaviour ──────────────────────────────────────────────────────

test("no ack when final response is ready before timer fires", () => {
  const sent: string[] = [];
  const { manager, timer } = makeManager();

  manager.startRequest({
    requestId: "req-1",
    sessionId: "sess-1",
    channelType: "telegram",
    sendFn: async (text) => { sent.push(text); }
  });

  assert.ok(timer.hasPending(), "timer should be pending after startRequest");

  manager.finalizeRequest("req-1");

  assert.ok(!timer.hasPending(), "timer should be cancelled after finalizeRequest");
  assert.equal(sent.length, 0, "no ack should have been sent");
});

test("ack is sent when timer fires before final response", async () => {
  const sent: string[] = [];
  const { manager, timer } = makeManager();

  manager.startRequest({
    requestId: "req-2",
    sessionId: "sess-2",
    channelType: "telegram",
    sendFn: async (text) => { sent.push(text); }
  });

  timer.fire(); // simulate ack threshold elapsed
  // sendFn is async — allow microtasks to resolve
  await Promise.resolve();

  assert.equal(sent.length, 1, "exactly one ack should have been sent");
});

test("final response still delivered after ack was sent", async () => {
  const sent: string[] = [];
  const { manager, timer } = makeManager();

  manager.startRequest({
    requestId: "req-3",
    sessionId: "sess-3",
    channelType: "telegram",
    sendFn: async (text) => { sent.push(text); }
  });

  timer.fire();
  await Promise.resolve();

  // Final response arrives after ack
  manager.finalizeRequest("req-3");

  // No duplicate ack; the final response text is sent by the caller, not by the manager
  assert.equal(sent.length, 1, "ack sent once, not again on finalize");
  assert.equal(manager.activeRequestCount, 0, "request cleaned up after finalize");
});

test("at most one ack is emitted per request", async () => {
  const sent: string[] = [];
  const fakeTimer = makeFakeTimer();
  const { manager } = makeManager({}, fakeTimer);

  manager.startRequest({
    requestId: "req-4",
    sessionId: "sess-4",
    channelType: "slack",
    sendFn: async (text) => { sent.push(text); }
  });

  // Fire the timer twice (defensive — in practice the timer fires once)
  fakeTimer.fire();
  await Promise.resolve();
  fakeTimer.fire();
  await Promise.resolve();

  assert.equal(sent.length, 1, "ack must be sent exactly once");
});

test("ack not sent when timer fires after finalizeRequest already called", async () => {
  const sent: string[] = [];
  const { manager, timer } = makeManager();

  manager.startRequest({
    requestId: "req-5",
    sessionId: "sess-5",
    channelType: "telegram",
    sendFn: async (text) => { sent.push(text); }
  });

  // Final arrives first — timer is cleared
  manager.finalizeRequest("req-5");

  // Manually call fire to simulate a timer that fires after clear (edge case)
  timer.fire(); // pending is null, so this is a no-op
  await Promise.resolve();

  assert.equal(sent.length, 0, "ack must not be sent after finalize");
});

// ── cancelRequest ─────────────────────────────────────────────────────────────

test("cancelRequest prevents ack from firing", async () => {
  const sent: string[] = [];
  const fakeTimer = makeFakeTimer();
  const { manager } = makeManager({}, fakeTimer);

  manager.startRequest({
    requestId: "req-6",
    sessionId: "sess-6",
    channelType: "telegram",
    sendFn: async (text) => { sent.push(text); }
  });

  manager.cancelRequest("req-6", "processing_error");

  fakeTimer.fire();
  await Promise.resolve();

  assert.equal(sent.length, 0, "ack must not fire after cancel");
  assert.equal(manager.activeRequestCount, 0, "request cleaned up after cancel");
});

// ── Disabled mode ─────────────────────────────────────────────────────────────

test("no ack emitted when enabled is false", async () => {
  const sent: string[] = [];
  const fakeTimer = makeFakeTimer();
  const { manager } = makeManager({ enabled: false }, fakeTimer);

  manager.startRequest({
    requestId: "req-7",
    sessionId: "sess-7",
    channelType: "telegram",
    sendFn: async (text) => { sent.push(text); }
  });

  assert.ok(!fakeTimer.hasPending(), "no timer should be registered when disabled");

  fakeTimer.fire();
  await Promise.resolve();

  assert.equal(sent.length, 0, "no ack when manager is disabled");
});

// ── Concurrent request isolation ─────────────────────────────────────────────

test("concurrent requests are isolated — only slow one gets ack", async () => {
  const sent: Record<string, string[]> = { fast: [], slow: [] };

  // Use separate timers per request to control them individually
  const fastTimer = makeFakeTimer();
  const slowTimer = makeFakeTimer();

  // Two managers sharing same config but different timer controls
  const fastManager = new DelayedAckManager(
    { enabled: true, ackDelayMs: 2000, contextualAckEnabled: true },
    nullLogger,
    { set: fastTimer.set, clear: fastTimer.clear }
  );
  const slowManager = new DelayedAckManager(
    { enabled: true, ackDelayMs: 2000, contextualAckEnabled: true },
    nullLogger,
    { set: slowTimer.set, clear: slowTimer.clear }
  );

  fastManager.startRequest({
    requestId: "fast-req",
    sessionId: "sess-fast",
    channelType: "telegram",
    sendFn: async (text) => { sent["fast"]!.push(text); }
  });
  slowManager.startRequest({
    requestId: "slow-req",
    sessionId: "sess-slow",
    channelType: "slack",
    sendFn: async (text) => { sent["slow"]!.push(text); }
  });

  // Fast request completes before timer fires
  fastManager.finalizeRequest("fast-req");

  // Slow request timer fires
  slowTimer.fire();
  await Promise.resolve();

  assert.equal(sent["fast"]!.length, 0, "fast request should not get ack");
  assert.equal(sent["slow"]!.length, 1, "slow request should get ack");
});

test("two requests on same manager are tracked independently", async () => {
  const { manager, timer } = makeManager();
  const sentA: string[] = [];
  const sentB: string[] = [];

  // Start A, then start B (timer for B will overwrite timer for A in our fake)
  // Use a multi-slot fake timer for this test
  const callbacks = new Map<number, () => void>();
  let idCounter = 0;
  const multiTimer = {
    set(fn: () => void, _ms: number): ReturnType<typeof setTimeout> {
      const id = ++idCounter;
      callbacks.set(id, fn);
      return id as unknown as ReturnType<typeof setTimeout>;
    },
    clear(h: ReturnType<typeof setTimeout>): void {
      callbacks.delete(h as unknown as number);
    },
    fireById(id: number): void {
      const fn = callbacks.get(id);
      if (fn) {
        callbacks.delete(id);
        fn();
      }
    }
  };

  const multiManager = new DelayedAckManager(
    { enabled: true, ackDelayMs: 2000, contextualAckEnabled: true },
    nullLogger,
    { set: multiTimer.set, clear: multiTimer.clear }
  );

  multiManager.startRequest({
    requestId: "req-A",
    sessionId: "sess-A",
    channelType: "telegram",
    sendFn: async (text) => { sentA.push(text); }
  });
  const idA = idCounter;

  multiManager.startRequest({
    requestId: "req-B",
    sessionId: "sess-B",
    channelType: "slack",
    sendFn: async (text) => { sentB.push(text); }
  });
  const idB = idCounter;

  // Finalize A quickly (no ack for A)
  multiManager.finalizeRequest("req-A");

  // B's timer fires
  multiTimer.fireById(idB);
  await Promise.resolve();

  assert.equal(sentA.length, 0, "req-A: no ack (finalized before timer)");
  assert.equal(sentB.length, 1, "req-B: ack sent (timer fired before finalize)");

  // A's timer handle was cleared on finalize — firing it is a no-op
  multiTimer.fireById(idA);
  await Promise.resolve();
  assert.equal(sentA.length, 0, "req-A: still no ack after stale timer fire");
});

// ── Contextual message selection ──────────────────────────────────────────────

test("contextual ack used when workflow type is known", async () => {
  const sent: string[] = [];
  const fakeTimer = makeFakeTimer();
  const { manager } = makeManager({ contextualAckEnabled: true }, fakeTimer);

  manager.startRequest({
    requestId: "req-ctx",
    sessionId: "sess-ctx",
    channelType: "telegram",
    workflowType: "gmail_read",
    sendFn: async (text) => { sent.push(text); }
  });

  fakeTimer.fire();
  await Promise.resolve();

  assert.equal(sent.length, 1);
  assert.equal(sent[0], "Looking through your email now.");
});

test("generic ack used when contextualAckEnabled is false", async () => {
  const sent: string[] = [];
  const fakeTimer = makeFakeTimer();
  const { manager } = makeManager({ contextualAckEnabled: false }, fakeTimer);

  manager.startRequest({
    requestId: "req-generic",
    sessionId: "sess-generic",
    channelType: "telegram",
    workflowType: "gmail_read",
    sendFn: async (text) => { sent.push(text); }
  });

  fakeTimer.fire();
  await Promise.resolve();

  const GENERIC = [
    "Got it — looking into that.",
    "Checking now.",
    "Working on it.",
    "Looking into your request.",
    "I'm pulling that together."
  ];
  assert.equal(sent.length, 1);
  assert.ok(GENERIC.includes(sent[0] ?? ""), `unexpected ack message: ${sent[0]}`);
});

test("generic ack used when workflow type has no contextual mapping", async () => {
  const sent: string[] = [];
  const fakeTimer = makeFakeTimer();
  const { manager } = makeManager({ contextualAckEnabled: true }, fakeTimer);

  manager.startRequest({
    requestId: "req-fallback",
    sessionId: "sess-fallback",
    channelType: "telegram",
    workflowType: "generic",
    sendFn: async (text) => { sent.push(text); }
  });

  fakeTimer.fire();
  await Promise.resolve();

  const GENERIC = [
    "Got it — looking into that.",
    "Checking now.",
    "Working on it.",
    "Looking into your request.",
    "I'm pulling that together."
  ];
  assert.equal(sent.length, 1);
  assert.ok(GENERIC.includes(sent[0] ?? ""), `unexpected fallback message: ${sent[0]}`);
});

// ── detectWorkflowType ────────────────────────────────────────────────────────

test("detectWorkflowType identifies gmail_read", () => {
  assert.equal(detectWorkflowType("show me my unread emails"), "gmail_read");
  assert.equal(detectWorkflowType("Check my inbox"), "gmail_read");
});

test("detectWorkflowType identifies gmail_write", () => {
  assert.equal(detectWorkflowType("Send an email to Alice"), "gmail_write");
  assert.equal(detectWorkflowType("compose a reply to Bob"), "gmail_write");
});

test("detectWorkflowType identifies calendar_read", () => {
  assert.equal(detectWorkflowType("what meetings do I have today?"), "calendar_read");
  assert.equal(detectWorkflowType("check my schedule for Thursday"), "calendar_read");
});

test("detectWorkflowType identifies drive_read", () => {
  assert.equal(detectWorkflowType("open my spreadsheet on Google Drive"), "drive_read");
});

test("detectWorkflowType identifies file_read", () => {
  assert.equal(detectWorkflowType("read file /tmp/notes.txt"), "file_read");
});

test("detectWorkflowType identifies web_search", () => {
  assert.equal(detectWorkflowType("search for the latest TypeScript release"), "web_search");
});

test("detectWorkflowType identifies remote_execution", () => {
  assert.equal(detectWorkflowType("run the deploy script"), "remote_execution");
});

test("detectWorkflowType identifies long_summary", () => {
  assert.equal(detectWorkflowType("summarize this document for me"), "long_summary");
});

test("detectWorkflowType falls back to generic for ambiguous input", () => {
  assert.equal(detectWorkflowType("hello"), "generic");
  assert.equal(detectWorkflowType("what time is it?"), "generic");
  assert.equal(detectWorkflowType(""), "generic");
});

// ── activeRequestCount ────────────────────────────────────────────────────────

test("activeRequestCount reflects live in-flight requests", async () => {
  const fakeTimer = makeFakeTimer();
  const { manager } = makeManager({}, fakeTimer);

  assert.equal(manager.activeRequestCount, 0);

  manager.startRequest({
    requestId: "cnt-1",
    sessionId: "s",
    channelType: "telegram",
    sendFn: async () => {}
  });
  assert.equal(manager.activeRequestCount, 1);

  manager.finalizeRequest("cnt-1");
  assert.equal(manager.activeRequestCount, 0);
});

test("activeRequestCount drops to zero after ack fires and request is still tracked until finalize", async () => {
  const fakeTimer = makeFakeTimer();
  const { manager } = makeManager({}, fakeTimer);

  manager.startRequest({
    requestId: "cnt-2",
    sessionId: "s",
    channelType: "slack",
    sendFn: async () => {}
  });

  // Timer fires — ack is sent but request stays in map until finalize
  fakeTimer.fire();
  await Promise.resolve();

  assert.equal(manager.activeRequestCount, 1, "request tracked until finalize even after ack");

  manager.finalizeRequest("cnt-2");
  assert.equal(manager.activeRequestCount, 0, "cleaned up after finalize");
});

// ── sendFn error resilience ───────────────────────────────────────────────────

test("sendFn error does not crash manager or leave state corrupted", async () => {
  const fakeTimer = makeFakeTimer();
  const errors: string[] = [];
  const errorLogger: AckLogger = {
    ...nullLogger,
    error: (_msg, fields) => { errors.push(String(fields?.["error"] ?? "")); }
  };

  const manager = new DelayedAckManager(
    { enabled: true, ackDelayMs: 2000, contextualAckEnabled: true },
    errorLogger,
    { set: fakeTimer.set, clear: fakeTimer.clear }
  );

  manager.startRequest({
    requestId: "err-1",
    sessionId: "s",
    channelType: "telegram",
    sendFn: async () => { throw new Error("network failure"); }
  });

  fakeTimer.fire();
  await Promise.resolve();

  assert.equal(errors.length, 1, "error should be logged");
  assert.ok(errors[0]?.includes("network failure"), "error message should be logged");

  // Manager should still accept a finalize without throwing
  assert.doesNotThrow(() => manager.finalizeRequest("err-1"));
});
