import type {
  NormalizedCalendarListResult,
  NormalizedGmailMessage,
  NormalizedGmailSearchResult
} from "../gog/gog-output-parsers.js";

const MAX_BODY_CHARS = 100_000;
const MAX_SNIPPET_CHARS = 2_000;

export function truncateNativeText(value: string | undefined, max = MAX_BODY_CHARS): string | undefined {
  if (!value) return undefined;
  return value.length > max ? value.slice(0, max) : value;
}

function decodeBase64Url(input: string): string {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(normalized + "=".repeat((4 - normalized.length % 4) % 4), "base64").toString("utf8");
}

interface GmailPart {
  mimeType?: string;
  filename?: string;
  body?: { data?: string; attachmentId?: string; size?: number };
  headers?: Array<{ name: string; value: string }>;
  parts?: GmailPart[];
}

export interface NativeGmailMessageRaw {
  id: string;
  threadId?: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  payload?: GmailPart;
}

function header(payload: GmailPart | undefined, name: string): string | undefined {
  return payload?.headers?.find((item) => item.name.toLowerCase() === name.toLowerCase())?.value;
}

function splitRecipients(value: string | undefined): string[] | undefined {
  const out = value?.split(",").map((item) => item.trim()).filter(Boolean);
  return out && out.length > 0 ? out : undefined;
}

function collectParts(part: GmailPart | undefined, out: GmailPart[] = []): GmailPart[] {
  if (!part) return out;
  out.push(part);
  for (const child of part.parts ?? []) collectParts(child, out);
  return out;
}

function extractBody(payload: GmailPart | undefined): { text?: string; html?: string } {
  const parts = collectParts(payload);
  const textPart = parts.find((part) => part.mimeType === "text/plain" && part.body?.data);
  const htmlPart = parts.find((part) => part.mimeType === "text/html" && part.body?.data);
  const direct = payload?.body?.data;
  const text = textPart?.body?.data ? truncateNativeText(decodeBase64Url(textPart.body.data)) : direct ? truncateNativeText(decodeBase64Url(direct)) : undefined;
  const html = htmlPart?.body?.data ? truncateNativeText(decodeBase64Url(htmlPart.body.data)) : undefined;
  return {
    ...(text ? { text } : {}),
    ...(html ? { html } : {})
  };
}

export function normalizeNativeGmailSearch(messages: NativeGmailMessageRaw[]): NormalizedGmailSearchResult {
  return {
    messages: messages.map((message) => ({
      id: message.id,
      ...(message.threadId ? { threadId: message.threadId } : {}),
      ...(header(message.payload, "From") ? { from: header(message.payload, "From") } : {}),
      ...(splitRecipients(header(message.payload, "To")) ? { to: splitRecipients(header(message.payload, "To")) } : {}),
      ...(header(message.payload, "Subject") ? { subject: header(message.payload, "Subject") } : {}),
      ...(truncateNativeText(message.snippet, MAX_SNIPPET_CHARS) ? { snippet: truncateNativeText(message.snippet, MAX_SNIPPET_CHARS) } : {}),
      ...(message.internalDate ? { receivedAt: new Date(Number(message.internalDate)).toISOString() } : header(message.payload, "Date") ? { receivedAt: header(message.payload, "Date") } : {})
    }))
  };
}

export function normalizeNativeGmailMessage(message: NativeGmailMessageRaw): NormalizedGmailMessage {
  const body = extractBody(message.payload);
  const attachments = collectParts(message.payload)
    .filter((part) => part.filename || part.body?.attachmentId)
    .flatMap((part) => part.filename || part.body?.attachmentId
      ? [{
          ...(part.body?.attachmentId ? { id: part.body.attachmentId } : {}),
          filename: part.filename ?? "",
          ...(part.mimeType ? { mimeType: part.mimeType } : {}),
          ...(typeof part.body?.size === "number" ? { sizeBytes: part.body.size } : {})
        }]
      : []);
  return {
    id: message.id,
    ...(message.threadId ? { threadId: message.threadId } : {}),
    ...(header(message.payload, "From") ? { from: header(message.payload, "From") } : {}),
    ...(splitRecipients(header(message.payload, "To")) ? { to: splitRecipients(header(message.payload, "To")) } : {}),
    ...(splitRecipients(header(message.payload, "Cc")) ? { cc: splitRecipients(header(message.payload, "Cc")) } : {}),
    ...(header(message.payload, "Subject") ? { subject: header(message.payload, "Subject") } : {}),
    ...(body.text ? { text: body.text } : {}),
    ...(body.html ? { html: body.html } : {}),
    ...(truncateNativeText(message.snippet, MAX_SNIPPET_CHARS) ? { snippet: truncateNativeText(message.snippet, MAX_SNIPPET_CHARS) } : {}),
    ...(message.internalDate ? { receivedAt: new Date(Number(message.internalDate)).toISOString() } : {}),
    ...(attachments.length > 0 ? { attachments } : {})
  };
}

export interface NativeCalendarEventRaw {
  id: string;
  summary?: string;
  start?: { dateTime?: string; date?: string; timeZone?: string };
  end?: { dateTime?: string; date?: string; timeZone?: string };
  location?: string;
  attendees?: Array<{ email?: string }>;
  description?: string;
}

export function normalizeNativeCalendarEvents(events: NativeCalendarEventRaw[], calendarId: string): NormalizedCalendarListResult {
  return {
    events: events.map((event) => ({
      id: event.id,
      calendarId,
      ...(event.summary ? { title: event.summary } : {}),
      ...(event.start?.dateTime ?? event.start?.date ? { start: event.start?.dateTime ?? event.start?.date } : {}),
      ...(event.end?.dateTime ?? event.end?.date ? { end: event.end?.dateTime ?? event.end?.date } : {}),
      ...(event.location ? { location: event.location } : {}),
      ...(event.attendees?.length ? { attendees: event.attendees.flatMap((item) => item.email ? [item.email] : []) } : {}),
      ...(truncateNativeText(event.description, MAX_SNIPPET_CHARS) ? { description: truncateNativeText(event.description, MAX_SNIPPET_CHARS) } : {})
    }))
  };
}
