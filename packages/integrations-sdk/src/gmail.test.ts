import assert from "node:assert/strict";
import test from "node:test";

import { GmailReadConnector, type GmailApiClient } from "./gmail.js";
import type { IntegrationAccountRecord } from "./index.js";

const account: IntegrationAccountRecord = {
  accountId: "integration:google:acct-1",
  providerId: "google",
  connectorId: "google-foundation",
  providerAccountId: "google-account:abc",
  status: "connected",
  scopesGranted: ["https://www.googleapis.com/auth/gmail.readonly"],
  tokenReference: "secretref:a",
  refreshTokenReference: "secretref:r",
  tokenExpiresAt: null,
  lastAuthAt: new Date().toISOString(),
  lastRefreshAt: null,
  lastError: null,
  revokedAt: null,
  disconnectedAt: null,
  metadata: {},
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
};

class MockClient implements GmailApiClient {
  constructor(private readonly data: Record<string, unknown>) {}
  async get<T>(url: string): Promise<T> {
    const key = Object.keys(this.data).find((k) => url.includes(k));
    if (!key) throw new Error(`no mock for ${url}`);
    return this.data[key] as T;
  }
}

function b64(input: string): string {
  return Buffer.from(input, "utf8").toString("base64url");
}

test("computes health and required gmail read capability", () => {
  const connector = new GmailReadConnector(new MockClient({}));
  const health = connector.computeHealth(account, true);
  assert.equal(health.connected, true);
  assert.equal(health.gmailReadAuthorized, true);
  assert.ok(health.availableCapabilities.includes("gmail.read_threads"));
});

test("lists messages with metadata and attachment flags", async () => {
  const connector = new GmailReadConnector(
    new MockClient({
      "/messages?": { messages: [{ id: "m1", threadId: "t1" }], resultSizeEstimate: 1 },
      "/messages/m1": {
        id: "m1",
        threadId: "t1",
        labelIds: ["INBOX", "UNREAD"],
        snippet: "hello",
        internalDate: String(Date.now()),
        payload: {
          headers: [
            { name: "From", value: "alice@example.com" },
            { name: "To", value: "me@example.com" },
            { name: "Subject", value: "Hello" }
          ],
          parts: [
            { mimeType: "text/plain", body: { data: b64("hello body") } },
            { mimeType: "application/pdf", filename: "a.pdf", body: { attachmentId: "att-1", size: 42 } }
          ]
        }
      }
    })
  );
  const result = await connector.listMessages("token", { maxResults: 5 });
  assert.equal(result.messages.length, 1);
  assert.equal(result.messages[0]?.hasAttachments, true);
  assert.equal(result.messages[0]?.attachmentCount, 1);
});

test("reads message detail with body + provenance", async () => {
  const connector = new GmailReadConnector(
    new MockClient({
      "/messages/m2": {
        id: "m2",
        threadId: "t2",
        labelIds: ["INBOX"],
        snippet: "hi",
        internalDate: String(Date.now()),
        payload: {
          headers: [
            { name: "From", value: "bob@example.com" },
            { name: "To", value: "me@example.com" },
            { name: "Subject", value: "Status" }
          ],
          parts: [{ mimeType: "text/plain", body: { data: b64("full body") } }]
        }
      }
    })
  );
  const detail = await connector.getMessage("token", "m2", account);
  assert.equal(detail.bodyText, "full body");
  assert.equal(detail.provenance.source, "gmail");
  assert.equal(detail.provenance.trustClassification, "EXTERNAL_UNTRUSTED");
});

test("reads thread and returns ordered message details", async () => {
  const connector = new GmailReadConnector(
    new MockClient({
      "/threads/t1": {
        id: "t1",
        historyId: "h1",
        messages: [
          {
            id: "m10",
            threadId: "t1",
            internalDate: String(Date.now() - 1000),
            payload: { headers: [{ name: "Subject", value: "A" }, { name: "From", value: "a@x.com" }] }
          },
          {
            id: "m11",
            threadId: "t1",
            internalDate: String(Date.now()),
            payload: { headers: [{ name: "Subject", value: "A2" }, { name: "From", value: "b@x.com" }] }
          }
        ]
      }
    })
  );
  const thread = await connector.getThread("token", "t1", account);
  assert.equal(thread.threadId, "t1");
  assert.equal(thread.messages.length, 2);
  assert.equal(thread.latestMessageId, "m11");
});

test("maps message detail to provenance-aware ingress record", async () => {
  const connector = new GmailReadConnector(
    new MockClient({
      "/messages/m3": {
        id: "m3",
        threadId: "t3",
        snippet: "snip",
        payload: {
          headers: [
            { name: "From", value: "boss@example.com" },
            { name: "Subject", value: "Review" }
          ],
          parts: [{ mimeType: "text/plain", body: { data: b64("please review") } }]
        }
      }
    })
  );
  const detail = await connector.getMessage("token", "m3", account);
  const record = connector.toIngressRecord(detail);
  assert.equal(record.sourceType, "gmail_message");
  assert.equal(record.trustClassification, "EXTERNAL_UNTRUSTED");
  assert.equal(record.provenance.messageId, "m3");
});
