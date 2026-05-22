import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import test from "node:test";

import {
  buildGogCommand,
  checkGogAuth,
  checkGogBinary,
  GogGoogleProvider,
  parseGogOutput,
  runGogProcess,
  type GogProcessRequest,
  type GogProcessResult,
  type GogSpawn
} from "./index.js";

function processResult(overrides: Partial<GogProcessResult> = {}): GogProcessResult {
  return {
    ok: true,
    command: "gog",
    args: [],
    redactedArgs: [],
    exitCode: 0,
    stdout: "",
    stderr: "",
    durationMs: 1,
    timedOut: false,
    truncated: { stdout: false, stderr: false },
    ...overrides
  };
}

test("binary detection returns found when gog --version succeeds", async () => {
  const check = await checkGogBinary({
    runner: async (request) => processResult({ args: request.args, stdout: "gog 1.2.3\n" })
  });
  assert.equal(check.status, "found");
  assert.equal(check.version, "gog 1.2.3");
});

test("binary detection returns not_found when spawn reports ENOENT", async () => {
  const check = await checkGogBinary({
    runner: async (request) => processResult({ ok: false, args: request.args, exitCode: null, error: "spawn gog ENOENT" })
  });
  assert.equal(check.status, "not_found");
  assert.ok(check.nextSteps.some((step) => step.includes("Install gog")));
});

test("binary detection returns version_unreadable on non-zero exit", async () => {
  const check = await checkGogBinary({
    runner: async (request) => processResult({ ok: false, args: request.args, exitCode: 2, stderr: "bad" })
  });
  assert.equal(check.status, "version_unreadable");
});

test("auth validation parses JSON authorized services and does not leak full output", async () => {
  const check = await checkGogAuth({
    runner: async () => processResult({
      stdout: JSON.stringify({ accounts: [{ email: "alice@example.com", services: ["gmail", "calendar", "drive"] }] })
    })
  });
  assert.equal(check.ok, true);
  assert.equal(check.account, "alice@example.com");
  assert.equal(check.services.gmail.authorized, true);
  assert.equal(check.services.docs.authorized, false);
  assert.ok(!check.raw?.stdoutPreview?.includes("alice@example.com"));
});

test("auth validation returns not connected on command failure", async () => {
  const check = await checkGogAuth({
    runner: async () => processResult({ ok: false, exitCode: 1, stderr: "not logged in" })
  });
  assert.equal(check.ok, false);
  assert.equal(check.services.gmail.authorized, false);
});

test("auth validation warns on unexpected output", async () => {
  const check = await checkGogAuth({
    runner: async () => processResult({ stdout: "some unexpected table" })
  });
  assert.equal(check.ok, false);
  assert.ok(check.warnings.some((warning) => warning.includes("Could not confidently parse")));
});

test("command builder builds expected args for read capabilities", () => {
  assert.deepEqual(
    buildGogCommand("google.gmail.search", { query: "from:a@example.com", limit: 5 }).args,
    ["gmail", "search", "--query", "from:a@example.com", "--limit", "5", "--json"]
  );
  assert.deepEqual(
    buildGogCommand("google.gmail.read", { messageId: "msg-1" }).args,
    ["gmail", "read", "--message-id", "msg-1", "--json"]
  );
  assert.deepEqual(
    buildGogCommand("google.calendar.list", { timeMin: "2026-05-22", timeMax: "2026-05-23" }).args,
    ["calendar", "list", "--calendar-id", "primary", "--from", "2026-05-22", "--to", "2026-05-23", "--limit", "10", "--json"]
  );
});

test("command builder rejects unknown, write, long query, invalid limit, and unsafe ids", () => {
  assert.throws(() => buildGogCommand("google.gmail.nope", {}), /Unknown Google capability/);
  assert.throws(() => buildGogCommand("google.gmail.send", {}), /requires policy and approval/);
  assert.throws(() => buildGogCommand("google.gmail.search", { query: "x".repeat(513) }), /at most 512/);
  assert.throws(() => buildGogCommand("google.gmail.search", { query: "ok", limit: 51 }), /between 1 and 50/);
  assert.throws(() => buildGogCommand("google.drive.read", { fileId: "abc;rm" }), /unsupported characters/);
});

test("output parsers parse JSON and reject invalid JSON", () => {
  const gmail = parseGogOutput("gmail.search", JSON.stringify({ messages: [{ id: "m1", subject: "Hi" }] }));
  assert.equal(gmail.ok, true);
  assert.equal((gmail.data as { messages: Array<{ id: string }> }).messages[0]?.id, "m1");

  const calendar = parseGogOutput("calendar.list", JSON.stringify({ events: [{ id: "e1", summary: "Meet" }] }));
  assert.equal(calendar.ok, true);

  const drive = parseGogOutput("drive.search", JSON.stringify({ files: [{ id: "f1", name: "Doc" }] }));
  assert.equal(drive.ok, true);

  const invalid = parseGogOutput("gmail.search", "not json");
  assert.equal(invalid.ok, false);
  assert.equal(invalid.parserStatus, "parser_error");
});

test("process runner uses args array, captures output, redacts args, and truncates", async () => {
  let observedArgs: readonly string[] = [];
  const fakeSpawn: GogSpawn = (_command, args) => {
    observedArgs = args;
    const child = new EventEmitter() as any;
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => true;
    child.killed = false;
    setTimeout(() => {
      child.stdout.write("abcdef");
      child.stderr.write("err");
      child.stdout.end();
      child.stderr.end();
      child.emit("close", 0);
    }, 1);
    return child;
  };
  const result = await runGogProcess({ args: ["gmail", "search", "--query", "secret"], maxStdoutBytes: 3, redactArgs: ["secret"] }, fakeSpawn);
  assert.deepEqual(observedArgs, ["gmail", "search", "--query", "secret"]);
  assert.equal(result.stdout, "abc");
  assert.equal(result.truncated.stdout, true);
  assert.deepEqual(result.redactedArgs, ["gmail", "search", "--query", "<redacted>"]);
});

test("process runner enforces timeout", async () => {
  const fakeSpawn: GogSpawn = () => {
    const child = new EventEmitter() as any;
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.killed = false;
    child.kill = () => {
      child.killed = true;
      setTimeout(() => child.emit("close", null), 1);
      return true;
    };
    return child;
  };
  const result = await runGogProcess({ args: ["slow"], timeoutMs: 5 }, fakeSpawn);
  assert.equal(result.timedOut, true);
  assert.equal(result.ok, false);
});

const authorizedServices = {
  gmail: { service: "gmail" as const, authorized: true },
  calendar: { service: "calendar" as const, authorized: true },
  drive: { service: "drive" as const, authorized: true },
  docs: { service: "docs" as const, authorized: true },
  sheets: { service: "sheets" as const, authorized: false },
  contacts: { service: "contacts" as const, authorized: true }
};

function provider(runner: (request: GogProcessRequest) => Promise<GogProcessResult> = async (request) => processResult({ args: request.args, redactedArgs: request.args, stdout: JSON.stringify({ messages: [{ id: "m1" }] }) })) {
  return new GogGoogleProvider({
    binaryCheck: async () => ({ ok: true, status: "found", binaryPath: "gog", version: "gog test", errors: [], warnings: [], nextSteps: [] }),
    authCheck: async () => ({ ok: true, account: "user@example.com", services: authorizedServices, warnings: [], errors: [], nextSteps: [] }),
    runner
  });
}

test("GogGoogleProvider executes read capability and includes audit metadata", async () => {
  const result = await provider().execute({ capabilityId: "google.gmail.search", input: { query: "in:inbox" }, correlationId: "corr-1" });
  assert.equal(result.status, "completed");
  assert.equal(result.ok, true);
  assert.equal(result.audit?.executed, true);
  assert.equal(result.audit?.command, "gog");
});

test("GogGoogleProvider blocks write and returns not_connected when service auth missing", async () => {
  const write = await provider().execute({ capabilityId: "google.gmail.send", input: {} });
  assert.equal(write.status, "blocked");

  const missing = new GogGoogleProvider({
    binaryCheck: async () => ({ ok: true, status: "found", binaryPath: "gog", errors: [], warnings: [], nextSteps: [] }),
    authCheck: async () => ({ ok: true, services: { ...authorizedServices, gmail: { service: "gmail", authorized: false } }, warnings: [], errors: [], nextSteps: [] }),
    runner: async (request) => processResult({ args: request.args })
  });
  const read = await missing.execute({ capabilityId: "google.gmail.search", input: { query: "in:inbox" } });
  assert.equal(read.status, "not_connected");
});

test("GogGoogleProvider returns parser_error and failed outcomes with audit", async () => {
  const parser = await provider(async (request) => processResult({ args: request.args, redactedArgs: request.args, stdout: "not json" }))
    .execute({ capabilityId: "google.gmail.search", input: { query: "in:inbox" } });
  assert.equal(parser.status, "parser_error");
  assert.equal(parser.audit?.executed, true);

  const failed = await provider(async (request) => processResult({ ok: false, args: request.args, redactedArgs: request.args, exitCode: 1, stderr: "bad" }))
    .execute({ capabilityId: "google.gmail.search", input: { query: "in:inbox" } });
  assert.equal(failed.status, "failed");
  assert.equal(failed.audit?.exitCode, 1);
});
