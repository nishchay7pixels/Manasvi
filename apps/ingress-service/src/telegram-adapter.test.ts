import assert from "node:assert/strict";
import test from "node:test";

import {
  extractResponseTextFromOrchestratorResult,
  normalizeTelegramUpdate,
  parseTelegramWebhook
} from "./telegram-adapter.js";

test("normalizeTelegramUpdate maps telegram message to canonical ingress payload fields", () => {
  const normalized = normalizeTelegramUpdate({
    update: {
      update_id: 1001,
      message: {
        message_id: 55,
        text: "hello from telegram",
        chat: {
          id: 222,
          type: "private"
        },
        from: {
          id: 777,
          is_bot: false,
          first_name: "Alice"
        }
      }
    },
    tenantId: "tenant-local",
    workspaceId: "workspace-local"
  });
  assert.ok(normalized);
  assert.equal(normalized?.actor.principalId, "telegram-user:777");
  assert.equal(normalized?.channel.principalId, "telegram-chat:222");
  assert.equal(normalized?.channel.messageId, "telegram:222:55");
  assert.equal(normalized?.session?.conversationId, "telegram-chat:222");
});

test("normalizeTelegramUpdate ignores non-text updates", () => {
  const normalized = normalizeTelegramUpdate({
    update: {
      update_id: 2002,
      message: {
        message_id: 99,
        chat: {
          id: 1,
          type: "private"
        }
      }
    },
    tenantId: "tenant-local",
    workspaceId: "workspace-local"
  });
  assert.equal(normalized, null);
});

test("extractResponseTextFromOrchestratorResult handles harness and agent-runtime shapes", () => {
  const harnessText = extractResponseTextFromOrchestratorResult({
    responseText: "harness response"
  });
  assert.equal(harnessText, "harness response");
  const runtimeText = extractResponseTextFromOrchestratorResult({
    outcome: {
      status: "completed",
      responseText: "runtime response"
    }
  });
  assert.equal(runtimeText, "runtime response");
});

test("parseTelegramWebhook enforces webhook secret when configured", () => {
  const parsed = parseTelegramWebhook({
    body: {
      update_id: 3003,
      message: {
        message_id: 9,
        text: "ping",
        chat: { id: 222, type: "private" },
        from: { id: 777, is_bot: false }
      }
    },
    tenantId: "tenant-local",
    workspaceId: "workspace-local",
    webhookSecret: "expected-secret",
    providedSecretHeader: "wrong-secret"
  });
  assert.equal(parsed.ok, false);
  if (parsed.ok) {
    return;
  }
  assert.equal(parsed.statusCode, 401);
});

test("parseTelegramWebhook returns normalized payload when secret matches", () => {
  const parsed = parseTelegramWebhook({
    body: {
      update_id: 3003,
      message: {
        message_id: 9,
        text: "ping",
        chat: { id: 222, type: "private" },
        from: { id: 777, is_bot: false }
      }
    },
    tenantId: "tenant-local",
    workspaceId: "workspace-local",
    webhookSecret: "expected-secret",
    providedSecretHeader: "expected-secret"
  });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) {
    return;
  }
  assert.equal(parsed.normalized.source.authenticity.verified, true);
  assert.equal(parsed.normalized.source.authenticity.authnStrength, "strong");
});
