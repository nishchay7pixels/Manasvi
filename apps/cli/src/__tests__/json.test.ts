/**
 * Tests for JSON output helpers and secret masking.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  jsonOk,
  jsonFail,
  maskValue,
  maskEnvMap,
  isSensitiveKey
} from "../lib/json.js";

describe("jsonOk", () => {
  test("produces correct shape", () => {
    const r = jsonOk("status", { healthy: true });
    assert.equal(r.ok, true);
    assert.equal(r.command, "status");
    assert.ok(r.timestamp.length > 0);
    assert.deepEqual(r.data, { healthy: true });
    assert.deepEqual(r.errors, []);
    assert.deepEqual(r.warnings, []);
    assert.deepEqual(r.nextSteps, []);
  });

  test("includes warnings and nextSteps", () => {
    const r = jsonOk("doctor", {}, {
      warnings: [{ code: "w", message: "warn" }],
      nextSteps: ["pnpm manasvi start"]
    });
    assert.equal(r.warnings.length, 1);
    assert.equal(r.nextSteps[0], "pnpm manasvi start");
  });

  test("timestamp is valid ISO string", () => {
    const r = jsonOk("test", {});
    assert.ok(!isNaN(Date.parse(r.timestamp)));
  });
});

describe("jsonFail", () => {
  test("produces ok=false", () => {
    const r = jsonFail("config validate", [{ code: "err", message: "bad" }]);
    assert.equal(r.ok, false);
    assert.equal(r.errors.length, 1);
    assert.equal(r.errors[0]!.code, "err");
  });

  test("includes fix in error", () => {
    const r = jsonFail("init", [{ code: "c", message: "m", fix: "pnpm manasvi init" }]);
    assert.equal(r.errors[0]!.fix, "pnpm manasvi init");
  });
});

describe("maskValue", () => {
  test("masks most of the value", () => {
    const masked = maskValue("sk-abc1234567890xyz9a2f");
    assert.ok(masked.includes("9a2f"), "should preserve last 4 chars");
    assert.ok(masked.includes("•"), "should use bullet mask");
    assert.ok(!masked.includes("sk-abc"), "should not include start of secret");
  });

  test("masks short values with full mask", () => {
    const masked = maskValue("abc");
    assert.ok(masked.includes("•"));
  });

  test("masks empty string", () => {
    const masked = maskValue("");
    assert.ok(masked.includes("•"));
  });
});

describe("isSensitiveKey", () => {
  const sensitiveKeys = [
    "DEEPSEEK_API_KEY",
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "TELEGRAM_BOT_TOKEN",
    "SLACK_BOT_TOKEN",
    "INTERNAL_AUTH_SIGNING_SECRET",
    "APPROVAL_SIGNING_KEYS",
    "MEMORY_ENCRYPTION_KEY",
    "API_GATEWAY_AUTH_TOKEN"
  ];

  for (const key of sensitiveKeys) {
    test(`identifies ${key} as sensitive`, () => {
      assert.equal(isSensitiveKey(key), true);
    });
  }

  const safeKeys = [
    "MODEL_ADAPTER_MODE",
    "MANASVI_ENV",
    "LOG_LEVEL",
    "POLICY_SERVICE_BASE_URL"
  ];

  for (const key of safeKeys) {
    test(`identifies ${key} as not sensitive`, () => {
      assert.equal(isSensitiveKey(key), false);
    });
  }
});

describe("maskEnvMap", () => {
  const env = {
    MODEL_ADAPTER_MODE: "deepseek",
    DEEPSEEK_API_KEY: "sk-test1234567890abcdef9a2f",
    LOG_LEVEL: "info",
    TELEGRAM_BOT_TOKEN: "123456789:AAEOm3xxxxxxxx"
  };

  test("masks sensitive keys by default", () => {
    const masked = maskEnvMap(env, false);
    assert.ok(masked.DEEPSEEK_API_KEY!.includes("•"));
    assert.ok(masked.TELEGRAM_BOT_TOKEN!.includes("•"));
    assert.equal(masked.MODEL_ADAPTER_MODE, "deepseek");
    assert.equal(masked.LOG_LEVEL, "info");
  });

  test("does not mask when showSecrets=true", () => {
    const unmasked = maskEnvMap(env, true);
    assert.equal(unmasked.DEEPSEEK_API_KEY, env.DEEPSEEK_API_KEY);
    assert.equal(unmasked.TELEGRAM_BOT_TOKEN, env.TELEGRAM_BOT_TOKEN);
  });
});
