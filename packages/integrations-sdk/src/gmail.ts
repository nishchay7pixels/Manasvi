import type { IntegrationAccountRecord } from "./index.js";
import { deriveGoogleCapabilities, type GoogleCapabilityId } from "./permissions.js";

export type GmailIntegrationHealthStatus =
  | "connected"
  | "authorized_read"
  | "degraded"
  | "token_refresh_needed"
  | "refresh_failed"
  | "disconnected"
  | "error";

export interface GmailConnectorHealth {
  providerId: "google";
  connectorId: string;
  accountId: string | null;
  status: GmailIntegrationHealthStatus;
  connected: boolean;
  gmailReadAuthorized: boolean;
  requiredCapabilities: GoogleCapabilityId[];
  availableCapabilities: GoogleCapabilityId[];
  missingCapabilities: GoogleCapabilityId[];
  tokenPresent: boolean;
  tokenExpiresAt: string | null;
  providerReachable: boolean;
  lastSuccessfulReadAt: string | null;
  lastError: string | null;
}

export interface GmailAttachmentMetadata {
  attachmentId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
}

export interface GmailMessageSummary {
  messageId: string;
  threadId: string;
  subject: string;
  from: string;
  to: string[];
  cc: string[];
  timestamp: string;
  labels: string[];
  unread: boolean;
  important: boolean;
  snippet: string;
  hasAttachments: boolean;
  attachmentCount: number;
  participants: string[];
}

export interface GmailMessageDetail extends GmailMessageSummary {
  bodyText: string;
  bodyHtml: string | null;
  attachments: GmailAttachmentMetadata[];
  provenance: {
    source: "gmail";
    trustClassification: "EXTERNAL_UNTRUSTED";
    provider: "google";
    connectorId: string;
    accountId: string;
    threadId: string;
    messageId: string;
    labels: string[];
    fetchedAt: string;
  };
}

export interface GmailThreadSummary {
  threadId: string;
  latestTimestamp: string;
  messageCount: number;
  participants: string[];
  subject: string;
  unread: boolean;
  snippet: string;
}

export interface GmailThreadDetail {
  threadId: string;
  historyId: string | null;
  messages: GmailMessageDetail[];
  latestMessageId: string | null;
  participants: string[];
  subject: string;
}

export interface GmailSearchQuery {
  query?: string;
  labelIds?: string[];
  maxResults?: number;
  pageToken?: string;
  includeSpamTrash?: boolean;
}

export interface GmailListResult {
  messages: GmailMessageSummary[];
  nextPageToken: string | null;
  resultSizeEstimate: number;
}

export interface GmailThreadListResult {
  threads: GmailThreadSummary[];
  nextPageToken: string | null;
  resultSizeEstimate: number;
}

export interface GmailReadIngressRecord {
  sourceId: string;
  sourceType: "gmail_message";
  title: string;
  content: string;
  contentPreview: string;
  trustClassification: "EXTERNAL_UNTRUSTED";
  provenance: GmailMessageDetail["provenance"];
  metadata: {
    subject: string;
    from: string;
    to: string[];
    timestamp: string;
    labels: string[];
    hasAttachments: boolean;
  };
}

export interface GmailApiClient {
  get<T>(url: string, accessToken: string): Promise<T>;
}

export class FetchGmailApiClient implements GmailApiClient {
  async get<T>(url: string, accessToken: string): Promise<T> {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json"
      }
    });
    if (!response.ok) {
      throw new Error(`Gmail API read failed (${response.status})`);
    }
    return (await response.json()) as T;
  }
}

interface GmailMessagePart {
  partId?: string;
  mimeType?: string;
  filename?: string;
  body?: {
    size?: number;
    data?: string;
    attachmentId?: string;
  };
  headers?: Array<{ name: string; value: string }>;
  parts?: GmailMessagePart[];
}

interface GmailMessagePayload {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: Array<{ name: string; value: string }>;
  body?: {
    size?: number;
    data?: string;
    attachmentId?: string;
  };
  parts?: GmailMessagePart[];
}

interface GmailApiMessage {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  historyId?: string;
  internalDate?: string;
  payload?: GmailMessagePayload;
}

interface GmailApiThread {
  id: string;
  historyId?: string;
  messages?: GmailApiMessage[];
}

function decodeBase64Url(input: string): string {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padLength = (4 - (normalized.length % 4)) % 4;
  const padded = normalized + "=".repeat(padLength);
  return Buffer.from(padded, "base64").toString("utf8");
}

function headerValue(payload: GmailMessagePayload | undefined, name: string): string {
  if (!payload?.headers) return "";
  const hit = payload.headers.find((header) => header.name.toLowerCase() === name.toLowerCase());
  return hit?.value ?? "";
}

function collectParts(part: GmailMessagePart | undefined, out: GmailMessagePart[] = []): GmailMessagePart[] {
  if (!part) return out;
  out.push(part);
  for (const child of part.parts ?? []) {
    collectParts(child, out);
  }
  return out;
}

function extractBody(payload: GmailMessagePayload | undefined): { text: string; html: string | null } {
  if (!payload) return { text: "", html: null };
  const parts = collectParts(payload);
  const textPart = parts.find((part) => part.mimeType === "text/plain" && part.body?.data);
  const htmlPart = parts.find((part) => part.mimeType === "text/html" && part.body?.data);

  if (textPart?.body?.data) {
    return {
      text: decodeBase64Url(textPart.body.data),
      html: htmlPart?.body?.data ? decodeBase64Url(htmlPart.body.data) : null
    };
  }

  if (payload.body?.data) {
    return { text: decodeBase64Url(payload.body.data), html: null };
  }

  return { text: "", html: htmlPart?.body?.data ? decodeBase64Url(htmlPart.body.data) : null };
}

function extractAttachmentMetadata(payload: GmailMessagePayload | undefined): GmailAttachmentMetadata[] {
  if (!payload) return [];
  const parts = collectParts(payload);
  return parts
    .filter((part) => Boolean(part.body?.attachmentId) || Boolean(part.filename))
    .map((part) => ({
      attachmentId: part.body?.attachmentId ?? "",
      filename: part.filename ?? "",
      mimeType: part.mimeType ?? "application/octet-stream",
      sizeBytes: part.body?.size ?? 0
    }))
    .filter((att) => att.filename.length > 0 || att.attachmentId.length > 0);
}

function normalizeSummary(message: GmailApiMessage): GmailMessageSummary {
  const payload = message.payload;
  const from = headerValue(payload, "From");
  const toRaw = headerValue(payload, "To");
  const ccRaw = headerValue(payload, "Cc");
  const subject = headerValue(payload, "Subject");
  const dateHeader = headerValue(payload, "Date");
  const timestamp = message.internalDate ? new Date(Number(message.internalDate)).toISOString() : dateHeader || new Date().toISOString();
  const labels = message.labelIds ?? [];
  const attachments = extractAttachmentMetadata(payload);
  const to = toRaw ? toRaw.split(",").map((item) => item.trim()).filter(Boolean) : [];
  const cc = ccRaw ? ccRaw.split(",").map((item) => item.trim()).filter(Boolean) : [];
  const participants = [from, ...to, ...cc].filter(Boolean);

  return {
    messageId: message.id,
    threadId: message.threadId,
    subject,
    from,
    to,
    cc,
    timestamp,
    labels,
    unread: labels.includes("UNREAD"),
    important: labels.includes("IMPORTANT"),
    snippet: message.snippet ?? "",
    hasAttachments: attachments.length > 0,
    attachmentCount: attachments.length,
    participants
  };
}

function normalizeDetail(message: GmailApiMessage, account: IntegrationAccountRecord): GmailMessageDetail {
  const summary = normalizeSummary(message);
  const body = extractBody(message.payload);
  const attachments = extractAttachmentMetadata(message.payload);
  return {
    ...summary,
    bodyText: body.text,
    bodyHtml: body.html,
    attachments,
    provenance: {
      source: "gmail",
      trustClassification: "EXTERNAL_UNTRUSTED",
      provider: "google",
      connectorId: account.connectorId,
      accountId: account.accountId,
      threadId: summary.threadId,
      messageId: summary.messageId,
      labels: summary.labels,
      fetchedAt: new Date().toISOString()
    }
  };
}

export class GmailReadConnector {
  private lastSuccessfulReadAt: string | null = null;
  private lastError: string | null = null;

  constructor(
    private readonly apiClient: GmailApiClient,
    private readonly baseUrl = "https://gmail.googleapis.com/gmail/v1/users/me"
  ) {}

  computeHealth(account: IntegrationAccountRecord | null, tokenPresent: boolean): GmailConnectorHealth {
    if (!account) {
      return {
        providerId: "google",
        connectorId: "google-foundation",
        accountId: null,
        status: "disconnected",
        connected: false,
        gmailReadAuthorized: false,
        requiredCapabilities: ["gmail.read_threads"],
        availableCapabilities: [],
        missingCapabilities: ["gmail.read_threads"],
        tokenPresent: false,
        tokenExpiresAt: null,
        providerReachable: false,
        lastSuccessfulReadAt: this.lastSuccessfulReadAt,
        lastError: this.lastError
      };
    }

    const capabilities = deriveGoogleCapabilities(account.scopesGranted).availableCapabilities.map((item) => item.capabilityId);
    const requiredCapabilities: GoogleCapabilityId[] = ["gmail.read_threads"];
    const missingCapabilities = requiredCapabilities.filter((capability) => !capabilities.includes(capability));
    const gmailReadAuthorized = missingCapabilities.length === 0;

    let status: GmailIntegrationHealthStatus = "connected";
    if (account.status === "refresh_failed") status = "refresh_failed";
    else if (account.status === "token_refresh_needed") status = "token_refresh_needed";
    else if (!gmailReadAuthorized) status = "degraded";
    else status = "authorized_read";

    return {
      providerId: "google",
      connectorId: account.connectorId,
      accountId: account.accountId,
      status,
      connected: account.status === "connected",
      gmailReadAuthorized,
      requiredCapabilities,
      availableCapabilities: capabilities,
      missingCapabilities,
      tokenPresent,
      tokenExpiresAt: account.tokenExpiresAt,
      providerReachable: account.status === "connected" && tokenPresent,
      lastSuccessfulReadAt: this.lastSuccessfulReadAt,
      lastError: this.lastError ?? account.lastError
    };
  }

  async listMessages(accessToken: string, query: GmailSearchQuery = {}): Promise<GmailListResult> {
    const params = new URLSearchParams();
    if (query.query) params.set("q", query.query);
    if (query.maxResults) params.set("maxResults", String(query.maxResults));
    if (query.pageToken) params.set("pageToken", query.pageToken);
    if (query.includeSpamTrash) params.set("includeSpamTrash", "true");
    for (const labelId of query.labelIds ?? []) params.append("labelIds", labelId);

    const endpoint = `${this.baseUrl}/messages?${params.toString()}`;
    const listed = await this.apiClient.get<{ messages?: Array<{ id: string; threadId: string }>; nextPageToken?: string; resultSizeEstimate?: number }>(endpoint, accessToken);

    const messages: GmailMessageSummary[] = [];
    for (const item of listed.messages ?? []) {
      const msg = await this.getMessageRaw(accessToken, item.id);
      messages.push(normalizeSummary(msg));
    }

    this.lastSuccessfulReadAt = new Date().toISOString();
    this.lastError = null;

    return {
      messages,
      nextPageToken: listed.nextPageToken ?? null,
      resultSizeEstimate: listed.resultSizeEstimate ?? messages.length
    };
  }

  async searchMessages(accessToken: string, query: GmailSearchQuery): Promise<GmailListResult> {
    return this.listMessages(accessToken, query);
  }

  async listThreads(accessToken: string, query: GmailSearchQuery = {}): Promise<GmailThreadListResult> {
    const params = new URLSearchParams();
    if (query.query) params.set("q", query.query);
    if (query.maxResults) params.set("maxResults", String(query.maxResults));
    if (query.pageToken) params.set("pageToken", query.pageToken);
    for (const labelId of query.labelIds ?? []) params.append("labelIds", labelId);

    const endpoint = `${this.baseUrl}/threads?${params.toString()}`;
    const listed = await this.apiClient.get<{ threads?: Array<{ id: string }>; nextPageToken?: string; resultSizeEstimate?: number }>(endpoint, accessToken);

    const threads: GmailThreadSummary[] = [];
    for (const item of listed.threads ?? []) {
      const thread = await this.getThreadRaw(accessToken, item.id);
      const messages = thread.messages ?? [];
      const details = messages.map((message) => normalizeSummary(message));
      const latest = [...details].sort((a, b) => b.timestamp.localeCompare(a.timestamp))[0];
      const participants = [...new Set(details.flatMap((d) => d.participants))];
      threads.push({
        threadId: thread.id,
        latestTimestamp: latest?.timestamp ?? new Date().toISOString(),
        messageCount: details.length,
        participants,
        subject: latest?.subject ?? "",
        unread: details.some((d) => d.unread),
        snippet: latest?.snippet ?? ""
      });
    }

    this.lastSuccessfulReadAt = new Date().toISOString();
    this.lastError = null;

    return {
      threads,
      nextPageToken: listed.nextPageToken ?? null,
      resultSizeEstimate: listed.resultSizeEstimate ?? threads.length
    };
  }

  async getMessage(accessToken: string, messageId: string, account: IntegrationAccountRecord): Promise<GmailMessageDetail> {
    const raw = await this.getMessageRaw(accessToken, messageId);
    this.lastSuccessfulReadAt = new Date().toISOString();
    this.lastError = null;
    return normalizeDetail(raw, account);
  }

  async getThread(accessToken: string, threadId: string, account: IntegrationAccountRecord): Promise<GmailThreadDetail> {
    const raw = await this.getThreadRaw(accessToken, threadId);
    const messages = (raw.messages ?? []).map((message) => normalizeDetail(message, account));
    const participants = [...new Set(messages.flatMap((message) => message.participants))];
    const latest = [...messages].sort((a, b) => b.timestamp.localeCompare(a.timestamp))[0] ?? null;

    this.lastSuccessfulReadAt = new Date().toISOString();
    this.lastError = null;

    return {
      threadId: raw.id,
      historyId: raw.historyId ?? null,
      messages,
      latestMessageId: latest?.messageId ?? null,
      participants,
      subject: latest?.subject ?? ""
    };
  }

  toIngressRecord(message: GmailMessageDetail): GmailReadIngressRecord {
    return {
      sourceId: `gmail:${message.messageId}`,
      sourceType: "gmail_message",
      title: message.subject || `(no subject)`,
      content: message.bodyText || message.snippet,
      contentPreview: (message.bodyText || message.snippet).slice(0, 500),
      trustClassification: "EXTERNAL_UNTRUSTED",
      provenance: message.provenance,
      metadata: {
        subject: message.subject,
        from: message.from,
        to: message.to,
        timestamp: message.timestamp,
        labels: message.labels,
        hasAttachments: message.hasAttachments
      }
    };
  }

  private async getMessageRaw(accessToken: string, messageId: string): Promise<GmailApiMessage> {
    try {
      return await this.apiClient.get<GmailApiMessage>(`${this.baseUrl}/messages/${encodeURIComponent(messageId)}?format=full`, accessToken);
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : "unknown";
      throw error;
    }
  }

  private async getThreadRaw(accessToken: string, threadId: string): Promise<GmailApiThread> {
    try {
      return await this.apiClient.get<GmailApiThread>(`${this.baseUrl}/threads/${encodeURIComponent(threadId)}?format=full`, accessToken);
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : "unknown";
      throw error;
    }
  }
}
