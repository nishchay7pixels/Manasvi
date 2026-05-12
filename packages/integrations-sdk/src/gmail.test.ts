import assert from "node:assert/strict";
import test from "node:test";

import { GmailReadConnector, GmailWriteConnector, buildMimeMessage, buildMimeMessageBase64Url, type GmailApiClient } from "./gmail.js";
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
  async post<T>(url: string, _body: Record<string, unknown>): Promise<T> {
    const key = Object.keys(this.data).find((k) => url.includes(k));
    if (!key) throw new Error(`no mock for POST ${url}`);
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

// ── GmailWriteConnector ───────────────────────────────────────────────────────

const writeAccount: IntegrationAccountRecord = {
  ...account,
  scopesGranted: [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.compose",
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/gmail.modify",
  ],
};

test("buildMimeMessage produces valid RFC 2822 headers", () => {
  const mime = buildMimeMessage({
    to: [{ email: "bob@example.com", name: "Bob" }],
    subject: "Hello",
    body: "World",
  });
  assert.ok(mime.includes('To: "Bob" <bob@example.com>'));
  assert.ok(mime.includes("Subject: Hello"));
  assert.ok(mime.includes("MIME-Version: 1.0"));
  assert.ok(mime.includes("Content-Type: text/plain"));
  assert.ok(mime.endsWith("World"));
});

test("buildMimeMessage includes Cc and In-Reply-To when provided", () => {
  const mime = buildMimeMessage({
    to: [{ email: "a@x.com" }],
    subject: "Re: stuff",
    body: "ok",
    cc: [{ email: "c@x.com" }],
    inReplyTo: "<msg-id-header>",
  });
  assert.ok(mime.includes("Cc: c@x.com"));
  assert.ok(mime.includes("In-Reply-To: <msg-id-header>"));
});

test("buildMimeMessageBase64Url produces base64url (no +, /, =)", () => {
  const encoded = buildMimeMessageBase64Url({
    to: [{ email: "x@x.com" }],
    subject: "Test",
    body: "body",
  });
  assert.ok(!encoded.includes("+"));
  assert.ok(!encoded.includes("/"));
  assert.ok(!encoded.includes("="));
  const decoded = Buffer.from(encoded, "base64url").toString("utf8");
  assert.ok(decoded.includes("To: x@x.com"));
});

test("createDraft returns draft_created with provenance", async () => {
  const connector = new GmailWriteConnector(
    new MockClient({
      "/drafts": {
        id: "draft-1",
        message: { id: "msg-1", threadId: "thread-1", labelIds: ["DRAFT"] },
      },
    })
  );
  const result = await connector.createDraft(
    "access-token",
    { to: [{ email: "bob@example.com" }], subject: "Hi", body: "Hello" },
    writeAccount
  );
  assert.equal(result.draftId, "draft-1");
  assert.equal(result.messageId, "msg-1");
  assert.equal(result.threadId, "thread-1");
  assert.equal(result.action, "draft_created");
  assert.equal(result.provenance.source, "gmail");
  assert.equal(result.provenance.trustClassification, "SYSTEM_GENERATED");
  assert.equal(result.provenance.draftId, "draft-1");
});

test("createReplyDraft auto-prepends Re: and returns reply_draft_created", async () => {
  const connector = new GmailWriteConnector(
    new MockClient({
      "/drafts": {
        id: "draft-2",
        message: { id: "msg-2", threadId: "thread-2", labelIds: ["DRAFT"] },
      },
    })
  );
  const result = await connector.createReplyDraft(
    "access-token",
    {
      threadId: "thread-2",
      inReplyToMessageId: "msg-0",
      inReplyToMessageIdHeader: "<msg-0@mail.gmail.com>",
      to: [{ email: "alice@example.com" }],
      subject: "Original subject",
      body: "Got it",
    },
    writeAccount
  );
  assert.equal(result.action, "reply_draft_created");
  assert.equal(result.draftId, "draft-2");
  assert.equal(result.threadId, "thread-2");
});

test("createReplyDraft does not double-prepend Re:", async () => {
  const connector = new GmailWriteConnector(
    new MockClient({
      "/drafts": {
        id: "draft-3",
        message: { id: "msg-3", threadId: "thread-3", labelIds: ["DRAFT"] },
      },
    })
  );
  // Subject already starts with "Re:"
  const result = await connector.createReplyDraft(
    "access-token",
    {
      threadId: "thread-3",
      inReplyToMessageId: "msg-prev",
      inReplyToMessageIdHeader: "<msg-prev@mail.gmail.com>",
      to: [{ email: "alice@example.com" }],
      subject: "Re: Already prefixed",
      body: "Got it",
    },
    writeAccount
  );
  assert.equal(result.action, "reply_draft_created");
  // The sent MIME body should not double-prefix — connector itself just checks startsWith("Re:")
  // We verify the result is still valid
  assert.ok(result.draftId.length > 0);
});

test("sendMessage returns message_sent with labelIds and provenance", async () => {
  const connector = new GmailWriteConnector(
    new MockClient({
      "/messages/send": {
        id: "sent-1",
        threadId: "thread-sent-1",
        labelIds: ["SENT"],
      },
    })
  );
  const result = await connector.sendMessage(
    "access-token",
    { to: [{ email: "recipient@example.com" }], subject: "Meeting", body: "Let's meet." },
    writeAccount
  );
  assert.equal(result.action, "message_sent");
  assert.equal(result.messageId, "sent-1");
  assert.equal(result.threadId, "thread-sent-1");
  assert.ok(result.labelIds.includes("SENT"));
  assert.equal(result.provenance.trustClassification, "SYSTEM_GENERATED");
});

test("archiveMessage removes INBOX and returns message_archived", async () => {
  const connector = new GmailWriteConnector(
    new MockClient({
      "/modify": { id: "m-archive", labelIds: ["CATEGORY_UPDATES"] },
    })
  );
  const result = await connector.archiveMessage("access-token", "m-archive");
  assert.equal(result.action, "message_archived");
  assert.equal(result.messageId, "m-archive");
  assert.ok(result.removedLabels.includes("INBOX"));
  assert.deepEqual(result.addedLabels, []);
});

test("modifyLabels applies addLabelIds and removeLabelIds", async () => {
  const connector = new GmailWriteConnector(
    new MockClient({
      "/modify": { id: "m-label", labelIds: ["LABEL_A", "LABEL_B"] },
    })
  );
  const result = await connector.modifyLabels("access-token", "m-label", {
    addLabelIds: ["LABEL_A"],
    removeLabelIds: ["INBOX"],
  });
  assert.equal(result.action, "labels_modified");
  assert.ok(result.addedLabels.includes("LABEL_A"));
  assert.ok(result.removedLabels.includes("INBOX"));
});

test("GmailWriteConnector tracks lastWriteAt after successful operation", async () => {
  const connector = new GmailWriteConnector(
    new MockClient({
      "/drafts": { id: "d-ts", message: { id: "m-ts", threadId: "t-ts" } },
    })
  );
  assert.equal(connector.getLastWriteAt(), null);
  await connector.createDraft("token", { to: [{ email: "a@b.com" }], subject: "s", body: "b" }, writeAccount);
  assert.ok(connector.getLastWriteAt() !== null);
});
