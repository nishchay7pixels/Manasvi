import type { GogOutputParserId } from "./gog-command-builder.js";

export interface NormalizedGmailSearchResult {
  messages: Array<{
    id: string;
    threadId?: string | undefined;
    from?: string | undefined;
    to?: string[] | undefined;
    subject?: string | undefined;
    snippet?: string | undefined;
    receivedAt?: string | undefined;
  }>;
}

export interface NormalizedGmailMessage {
  id: string;
  threadId?: string | undefined;
  from?: string | undefined;
  to?: string[] | undefined;
  cc?: string[] | undefined;
  subject?: string | undefined;
  text?: string | undefined;
  html?: string | undefined;
  snippet?: string | undefined;
  receivedAt?: string | undefined;
  attachments?: Array<{
    id?: string | undefined;
    filename: string;
    mimeType?: string | undefined;
    sizeBytes?: number | undefined;
  }>;
}

export interface NormalizedCalendarListResult {
  events: Array<{
    id: string;
    calendarId?: string | undefined;
    title?: string | undefined;
    start?: string | undefined;
    end?: string | undefined;
    location?: string | undefined;
    attendees?: string[] | undefined;
    description?: string | undefined;
  }>;
}

export interface NormalizedDriveSearchResult {
  files: Array<{
    id: string;
    name: string;
    mimeType?: string | undefined;
    webUrl?: string | undefined;
    modifiedAt?: string | undefined;
  }>;
}

export interface NormalizedDriveReadResult {
  id: string;
  name?: string | undefined;
  mimeType?: string | undefined;
  text?: string | undefined;
  bytesBase64?: string | undefined;
}

export interface NormalizedDocsReadResult {
  documentId: string;
  title?: string | undefined;
  text?: string | undefined;
  format: string;
}

export interface NormalizedContactsSearchResult {
  contacts: Array<{
    id?: string | undefined;
    name?: string | undefined;
    email?: string | undefined;
    phone?: string | undefined;
  }>;
}

export interface GogParseResult<T = unknown> {
  ok: boolean;
  data?: T;
  warnings: string[];
  errors: string[];
  parserStatus: "parsed" | "parser_error";
}

const MAX_TEXT_CHARS = 100_000;
const MAX_SNIPPET_CHARS = 2_000;

function truncateText(value: unknown, max = MAX_TEXT_CHARS): string | undefined {
  if (typeof value !== "string") return undefined;
  return value.length > max ? value.slice(0, max) : value;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out = value.filter((item): item is string => typeof item === "string" && item.length > 0);
  return out.length > 0 ? out : undefined;
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function arrayFromShape(parsed: unknown, keys: string[]): unknown[] {
  if (Array.isArray(parsed)) return parsed;
  const object = objectValue(parsed);
  if (!object) return [];
  for (const key of keys) {
    if (Array.isArray(object[key])) return object[key] as unknown[];
  }
  return [];
}

function requireJson(stdout: string): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(stdout) as unknown };
  } catch {
    return { ok: false, error: "Could not parse gog JSON output." };
  }
}

function idFrom(object: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = stringValue(object[key]);
    if (value) return value;
  }
  return undefined;
}

function parseGmailSearch(parsed: unknown): GogParseResult<NormalizedGmailSearchResult> {
  const warnings: string[] = [];
  const messages = arrayFromShape(parsed, ["messages", "items", "results"]).flatMap((item) => {
    const object = objectValue(item);
    if (!object) return [];
    const id = idFrom(object, ["id", "messageId"]);
    if (!id) {
      warnings.push("Skipped Gmail search item without id.");
      return [];
    }
    return [{
      id,
      ...(stringValue(object.threadId) ? { threadId: stringValue(object.threadId) } : {}),
      ...(stringValue(object.from) ? { from: stringValue(object.from) } : {}),
      ...(stringArray(object.to) ? { to: stringArray(object.to) } : {}),
      ...(stringValue(object.subject) ? { subject: stringValue(object.subject) } : {}),
      ...(truncateText(object.snippet, MAX_SNIPPET_CHARS) ? { snippet: truncateText(object.snippet, MAX_SNIPPET_CHARS) } : {}),
      ...(stringValue(object.receivedAt ?? object.date) ? { receivedAt: stringValue(object.receivedAt ?? object.date) } : {})
    }];
  });
  return { ok: true, data: { messages }, warnings, errors: [], parserStatus: "parsed" };
}

function parseGmailMessage(parsed: unknown): GogParseResult<NormalizedGmailMessage> {
  const object = objectValue(parsed) ?? objectValue(arrayFromShape(parsed, ["messages", "items"])[0]);
  if (!object) return { ok: false, warnings: [], errors: ["Could not parse gog Gmail message output."], parserStatus: "parser_error" };
  const id = idFrom(object, ["id", "messageId"]);
  if (!id) return { ok: false, warnings: [], errors: ["Gmail message output did not include an id."], parserStatus: "parser_error" };
  const attachments = Array.isArray(object.attachments)
    ? object.attachments.flatMap((item) => {
      const attachment = objectValue(item);
      const filename = attachment ? stringValue(attachment.filename) : undefined;
      if (!attachment || !filename) return [];
      return [{
        ...(stringValue(attachment.id ?? attachment.attachmentId) ? { id: stringValue(attachment.id ?? attachment.attachmentId) } : {}),
        filename,
        ...(stringValue(attachment.mimeType) ? { mimeType: stringValue(attachment.mimeType) } : {}),
        ...(typeof attachment.sizeBytes === "number" ? { sizeBytes: attachment.sizeBytes } : {})
      }];
    })
    : undefined;
  return {
    ok: true,
    data: {
      id,
      ...(stringValue(object.threadId) ? { threadId: stringValue(object.threadId) } : {}),
      ...(stringValue(object.from) ? { from: stringValue(object.from) } : {}),
      ...(stringArray(object.to) ? { to: stringArray(object.to) } : {}),
      ...(stringArray(object.cc) ? { cc: stringArray(object.cc) } : {}),
      ...(stringValue(object.subject) ? { subject: stringValue(object.subject) } : {}),
      ...(truncateText(object.text ?? object.bodyText) ? { text: truncateText(object.text ?? object.bodyText) } : {}),
      ...(truncateText(object.html ?? object.bodyHtml) ? { html: truncateText(object.html ?? object.bodyHtml) } : {}),
      ...(truncateText(object.snippet, MAX_SNIPPET_CHARS) ? { snippet: truncateText(object.snippet, MAX_SNIPPET_CHARS) } : {}),
      ...(stringValue(object.receivedAt ?? object.date) ? { receivedAt: stringValue(object.receivedAt ?? object.date) } : {}),
      ...(attachments && attachments.length > 0 ? { attachments } : {})
    },
    warnings: [],
    errors: [],
    parserStatus: "parsed"
  };
}

function parseCalendarList(parsed: unknown): GogParseResult<NormalizedCalendarListResult> {
  const warnings: string[] = [];
  const events = arrayFromShape(parsed, ["events", "items", "results"]).flatMap((item) => {
    const object = objectValue(item);
    if (!object) return [];
    const id = idFrom(object, ["id", "eventId"]);
    if (!id) {
      warnings.push("Skipped Calendar event without id.");
      return [];
    }
    return [{
      id,
      ...(stringValue(object.calendarId) ? { calendarId: stringValue(object.calendarId) } : {}),
      ...(stringValue(object.title ?? object.summary) ? { title: stringValue(object.title ?? object.summary) } : {}),
      ...(stringValue(object.start ?? object.startIso) ? { start: stringValue(object.start ?? object.startIso) } : {}),
      ...(stringValue(object.end ?? object.endIso) ? { end: stringValue(object.end ?? object.endIso) } : {}),
      ...(stringValue(object.location) ? { location: stringValue(object.location) } : {}),
      ...(stringArray(object.attendees) ? { attendees: stringArray(object.attendees) } : {}),
      ...(truncateText(object.description, MAX_SNIPPET_CHARS) ? { description: truncateText(object.description, MAX_SNIPPET_CHARS) } : {})
    }];
  });
  return { ok: true, data: { events }, warnings, errors: [], parserStatus: "parsed" };
}

function parseDriveSearch(parsed: unknown): GogParseResult<NormalizedDriveSearchResult> {
  const warnings: string[] = [];
  const files = arrayFromShape(parsed, ["files", "items", "results"]).flatMap((item) => {
    const object = objectValue(item);
    if (!object) return [];
    const id = idFrom(object, ["id", "fileId"]);
    const name = stringValue(object.name ?? object.title);
    if (!id || !name) {
      warnings.push("Skipped Drive file without id or name.");
      return [];
    }
    return [{
      id,
      name,
      ...(stringValue(object.mimeType) ? { mimeType: stringValue(object.mimeType) } : {}),
      ...(stringValue(object.webUrl ?? object.webViewLink) ? { webUrl: stringValue(object.webUrl ?? object.webViewLink) } : {}),
      ...(stringValue(object.modifiedAt ?? object.modifiedTime) ? { modifiedAt: stringValue(object.modifiedAt ?? object.modifiedTime) } : {})
    }];
  });
  return { ok: true, data: { files }, warnings, errors: [], parserStatus: "parsed" };
}

function parseDriveRead(parsed: unknown): GogParseResult<NormalizedDriveReadResult> {
  const object = objectValue(parsed);
  if (!object) return { ok: false, warnings: [], errors: ["Could not parse gog Drive read output."], parserStatus: "parser_error" };
  const id = idFrom(object, ["id", "fileId"]);
  if (!id) return { ok: false, warnings: [], errors: ["Drive read output did not include an id."], parserStatus: "parser_error" };
  return {
    ok: true,
    data: {
      id,
      ...(stringValue(object.name ?? object.title) ? { name: stringValue(object.name ?? object.title) } : {}),
      ...(stringValue(object.mimeType) ? { mimeType: stringValue(object.mimeType) } : {}),
      ...(truncateText(object.text ?? object.content) ? { text: truncateText(object.text ?? object.content) } : {}),
      ...(stringValue(object.bytesBase64) ? { bytesBase64: stringValue(object.bytesBase64) } : {})
    },
    warnings: [],
    errors: [],
    parserStatus: "parsed"
  };
}

function parseDocsRead(parsed: unknown): GogParseResult<NormalizedDocsReadResult> {
  const object = objectValue(parsed);
  if (!object) return { ok: false, warnings: [], errors: ["Could not parse gog Docs output."], parserStatus: "parser_error" };
  const documentId = idFrom(object, ["documentId", "id"]);
  if (!documentId) return { ok: false, warnings: [], errors: ["Docs output did not include a documentId."], parserStatus: "parser_error" };
  return {
    ok: true,
    data: {
      documentId,
      ...(stringValue(object.title) ? { title: stringValue(object.title) } : {}),
      ...(truncateText(object.text ?? object.content) ? { text: truncateText(object.text ?? object.content) } : {}),
      format: stringValue(object.format) ?? "text"
    },
    warnings: [],
    errors: [],
    parserStatus: "parsed"
  };
}

function parseContactsSearch(parsed: unknown): GogParseResult<NormalizedContactsSearchResult> {
  const contacts = arrayFromShape(parsed, ["contacts", "items", "results"]).flatMap((item) => {
    const object = objectValue(item);
    if (!object) return [];
    return [{
      ...(stringValue(object.id ?? object.resourceName) ? { id: stringValue(object.id ?? object.resourceName) } : {}),
      ...(stringValue(object.name ?? object.displayName) ? { name: stringValue(object.name ?? object.displayName) } : {}),
      ...(stringValue(object.email) ? { email: stringValue(object.email) } : {}),
      ...(stringValue(object.phone) ? { phone: stringValue(object.phone) } : {})
    }];
  });
  return { ok: true, data: { contacts }, warnings: [], errors: [], parserStatus: "parsed" };
}

export function parseGogOutput(parser: GogOutputParserId, stdout: string): GogParseResult {
  const json = requireJson(stdout);
  if (!json.ok) {
    return { ok: false, warnings: [], errors: [json.error], parserStatus: "parser_error" };
  }
  switch (parser) {
    case "gmail.search":
      return parseGmailSearch(json.value);
    case "gmail.message":
      return parseGmailMessage(json.value);
    case "calendar.list":
      return parseCalendarList(json.value);
    case "drive.search":
      return parseDriveSearch(json.value);
    case "drive.read":
      return parseDriveRead(json.value);
    case "docs.read":
      return parseDocsRead(json.value);
    case "contacts.search":
      return parseContactsSearch(json.value);
    default:
      return { ok: false, warnings: [], errors: [`Unknown gog parser: ${String(parser)}`], parserStatus: "parser_error" };
  }
}
