import type { GoogleService } from "./google-capabilities.js";

export interface GmailSearchInput {
  query: string;
  limit?: number;
}

export interface GmailReadInput {
  messageId?: string;
  threadId?: string;
}

export interface CalendarListInput {
  timeMin?: string;
  timeMax?: string;
  calendarId?: string;
  limit?: number;
}

export interface DriveSearchInput {
  query?: string;
  mimeType?: string;
  limit?: number;
}

export interface DriveReadInput {
  fileId: string;
  exportMimeType?: string;
}

export interface DocsReadInput {
  documentId: string;
  format?: "text" | "markdown" | "html";
}

export interface DocsExportInput {
  documentId: string;
  format?: "txt" | "md" | "html" | "pdf";
}

export interface ContactsSearchInput {
  query: string;
  limit?: number;
}

export interface GmailDraftInput {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  bodyText?: string;
  bodyHtml?: string;
}

export interface GmailSendInput extends GmailDraftInput {
  replyToMessageId?: string;
}

export interface CalendarCreateInput {
  calendarId?: string;
  title: string;
  start: string;
  end: string;
  timezone?: string;
  location?: string;
  description?: string;
  attendees?: string[];
}

export interface CalendarUpdateInput {
  calendarId?: string;
  eventId: string;
  patch: {
    title?: string;
    start?: string;
    end?: string;
    timezone?: string;
    location?: string;
    description?: string;
    attendees?: string[];
  };
}

export interface CalendarDeleteInput {
  calendarId?: string;
  eventId: string;
}

export type GoogleReadCapabilityInput =
  | GmailSearchInput
  | GmailReadInput
  | CalendarListInput
  | DriveSearchInput
  | DriveReadInput
  | DocsReadInput
  | DocsExportInput
  | ContactsSearchInput;

export type GoogleNativeCapabilityInput =
  | GoogleReadCapabilityInput
  | GmailDraftInput
  | GmailSendInput
  | CalendarCreateInput
  | CalendarUpdateInput
  | CalendarDeleteInput;

export class GoogleCapabilityInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GoogleCapabilityInputError";
  }
}

export const GOOGLE_G2_READ_CAPABILITY_IDS = [
  "google.gmail.search",
  "google.gmail.read",
  "google.calendar.list",
  "google.drive.search",
  "google.drive.read",
  "google.docs.read",
  "google.docs.export",
  "google.contacts.search"
] as const;

export type GoogleG2ReadCapabilityId = (typeof GOOGLE_G2_READ_CAPABILITY_IDS)[number];

export const GOOGLE_G2_WRITE_BLOCKED_CAPABILITY_IDS = [
  "google.gmail.draft",
  "google.gmail.send",
  "google.calendar.create",
  "google.calendar.update",
  "google.calendar.delete",
  "google.docs.copy",
  "google.sheets.append",
  "google.sheets.update"
] as const;

export const GOOGLE_G3_NATIVE_CAPABILITY_IDS = [
  "google.gmail.search",
  "google.gmail.read",
  "google.gmail.draft",
  "google.gmail.send",
  "google.calendar.list",
  "google.calendar.create",
  "google.calendar.update",
  "google.calendar.delete"
] as const;

export function isG2ReadCapabilityId(capabilityId: string): capabilityId is GoogleG2ReadCapabilityId {
  return GOOGLE_G2_READ_CAPABILITY_IDS.includes(capabilityId as GoogleG2ReadCapabilityId);
}

function expectObject(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new GoogleCapabilityInputError("Input must be an object.");
  }
  return input as Record<string, unknown>;
}

function rejectUnknownFields(input: Record<string, unknown>, allowed: string[]): void {
  const allowedSet = new Set(allowed);
  const unknown = Object.keys(input).filter((key) => !allowedSet.has(key));
  if (unknown.length > 0) {
    throw new GoogleCapabilityInputError(`Unknown input field(s): ${unknown.join(", ")}`);
  }
}

function stringField(
  input: Record<string, unknown>,
  key: string,
  options: { required?: boolean; maxLength?: number; allowEmpty?: boolean; pattern?: RegExp } = {}
): string | undefined {
  const value = input[key];
  if (value === undefined || value === null) {
    if (options.required) throw new GoogleCapabilityInputError(`${key} is required.`);
    return undefined;
  }
  if (typeof value !== "string") {
    throw new GoogleCapabilityInputError(`${key} must be a string.`);
  }
  const trimmed = value.trim();
  if (!options.allowEmpty && trimmed.length === 0) {
    throw new GoogleCapabilityInputError(`${key} must not be empty.`);
  }
  if (options.maxLength && trimmed.length > options.maxLength) {
    throw new GoogleCapabilityInputError(`${key} must be at most ${options.maxLength} characters.`);
  }
  if (options.pattern && !options.pattern.test(trimmed)) {
    throw new GoogleCapabilityInputError(`${key} contains unsupported characters.`);
  }
  return trimmed;
}

function limitField(input: Record<string, unknown>): number {
  const value = input.limit;
  if (value === undefined || value === null) return 10;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 50) {
    throw new GoogleCapabilityInputError("limit must be an integer between 1 and 50.");
  }
  return value;
}

function isoLikeField(input: Record<string, unknown>, key: string): string | undefined {
  const value = stringField(input, key, { maxLength: 64 });
  if (!value) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}(?:[T ][0-9:.+-Z]+)?$/.test(value)) {
    throw new GoogleCapabilityInputError(`${key} must be an ISO-like date/time string.`);
  }
  return value;
}

const SAFE_ID_PATTERN = /^[A-Za-z0-9._:@-]+$/;
const MIME_PATTERN = /^[A-Za-z0-9.+-]+\/[A-Za-z0-9.+-]+$/;

function idField(input: Record<string, unknown>, key: string): string {
  return stringField(input, key, {
    required: true,
    maxLength: 256,
    pattern: SAFE_ID_PATTERN
  })!;
}

function optionalIdField(input: Record<string, unknown>, key: string): string | undefined {
  return stringField(input, key, { maxLength: 256, pattern: SAFE_ID_PATTERN });
}

function enumField<T extends string>(
  input: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
  fallback: T
): T {
  const value = input[key];
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new GoogleCapabilityInputError(`${key} must be one of: ${allowed.join(", ")}.`);
  }
  return value as T;
}

function stringArrayField(input: Record<string, unknown>, key: string, options: { required?: boolean; maxItems?: number; maxLength?: number; pattern?: RegExp } = {}): string[] | undefined {
  const value = input[key];
  if (value === undefined || value === null) {
    if (options.required) throw new GoogleCapabilityInputError(`${key} is required.`);
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new GoogleCapabilityInputError(`${key} must be an array.`);
  }
  const maxItems = options.maxItems ?? 50;
  if (value.length > maxItems) {
    throw new GoogleCapabilityInputError(`${key} must contain at most ${maxItems} items.`);
  }
  const out = value.map((item, index) => {
    if (typeof item !== "string") throw new GoogleCapabilityInputError(`${key}[${index}] must be a string.`);
    const trimmed = item.trim();
    if (!trimmed) throw new GoogleCapabilityInputError(`${key}[${index}] must not be empty.`);
    if (trimmed.length > (options.maxLength ?? 256)) {
      throw new GoogleCapabilityInputError(`${key}[${index}] is too long.`);
    }
    if (options.pattern && !options.pattern.test(trimmed)) {
      throw new GoogleCapabilityInputError(`${key}[${index}] contains unsupported characters.`);
    }
    return trimmed;
  });
  return out.length > 0 ? out : undefined;
}

function optionalText(input: Record<string, unknown>, key: string, maxLength = 100_000): string | undefined {
  return stringField(input, key, { maxLength });
}

const EMAILISH_PATTERN = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

function validateGmailWriteInput(capabilityId: string, input: Record<string, unknown>): GmailDraftInput | GmailSendInput {
  const allowed = capabilityId === "google.gmail.send"
    ? ["to", "cc", "bcc", "subject", "bodyText", "bodyHtml", "replyToMessageId"]
    : ["to", "cc", "bcc", "subject", "bodyText", "bodyHtml"];
  rejectUnknownFields(input, allowed);
  const bodyText = optionalText(input, "bodyText");
  const bodyHtml = optionalText(input, "bodyHtml");
  if (!bodyText && !bodyHtml) {
    throw new GoogleCapabilityInputError("Provide bodyText or bodyHtml.");
  }
  const cc = stringArrayField(input, "cc", { maxItems: 50, pattern: EMAILISH_PATTERN });
  const bcc = stringArrayField(input, "bcc", { maxItems: 50, pattern: EMAILISH_PATTERN });
  const base = {
    to: stringArrayField(input, "to", { required: true, maxItems: 50, pattern: EMAILISH_PATTERN })!,
    ...(cc ? { cc } : {}),
    ...(bcc ? { bcc } : {}),
    subject: stringField(input, "subject", { required: true, maxLength: 998 })!,
    ...(bodyText ? { bodyText } : {}),
    ...(bodyHtml ? { bodyHtml } : {})
  };
  if (capabilityId === "google.gmail.send") {
    const replyToMessageId = optionalIdField(input, "replyToMessageId");
    return { ...base, ...(replyToMessageId ? { replyToMessageId } : {}) };
  }
  return base;
}

function validateCalendarCreateInput(input: Record<string, unknown>): CalendarCreateInput {
  rejectUnknownFields(input, ["calendarId", "title", "start", "end", "timezone", "location", "description", "attendees"]);
  const calendarId = optionalIdField(input, "calendarId");
  const timezone = stringField(input, "timezone", { maxLength: 64 });
  const location = stringField(input, "location", { maxLength: 512 });
  const description = stringField(input, "description", { maxLength: 20_000 });
  const attendees = stringArrayField(input, "attendees", { maxItems: 100, pattern: EMAILISH_PATTERN });
  return {
    ...(calendarId ? { calendarId } : {}),
    title: stringField(input, "title", { required: true, maxLength: 512 })!,
    start: stringField(input, "start", { required: true, maxLength: 64 })!,
    end: stringField(input, "end", { required: true, maxLength: 64 })!,
    ...(timezone ? { timezone } : {}),
    ...(location ? { location } : {}),
    ...(description ? { description } : {}),
    ...(attendees ? { attendees } : {})
  };
}

function validateCalendarUpdateInput(input: Record<string, unknown>): CalendarUpdateInput {
  rejectUnknownFields(input, ["calendarId", "eventId", "patch"]);
  const patchValue = input.patch;
  if (!patchValue || typeof patchValue !== "object" || Array.isArray(patchValue)) {
    throw new GoogleCapabilityInputError("patch must be an object.");
  }
  const patch = patchValue as Record<string, unknown>;
  rejectUnknownFields(patch, ["title", "start", "end", "timezone", "location", "description", "attendees"]);
  const title = stringField(patch, "title", { maxLength: 512 });
  const start = stringField(patch, "start", { maxLength: 64 });
  const end = stringField(patch, "end", { maxLength: 64 });
  const timezone = stringField(patch, "timezone", { maxLength: 64 });
  const location = stringField(patch, "location", { maxLength: 512 });
  const description = stringField(patch, "description", { maxLength: 20_000 });
  const attendees = stringArrayField(patch, "attendees", { maxItems: 100, pattern: EMAILISH_PATTERN });
  const normalizedPatch = {
    ...(title ? { title } : {}),
    ...(start ? { start } : {}),
    ...(end ? { end } : {}),
    ...(timezone ? { timezone } : {}),
    ...(location ? { location } : {}),
    ...(description ? { description } : {}),
    ...(attendees ? { attendees } : {})
  };
  if (Object.keys(normalizedPatch).length === 0) {
    throw new GoogleCapabilityInputError("patch must include at least one supported field.");
  }
  return {
    ...(optionalIdField(input, "calendarId") ? { calendarId: optionalIdField(input, "calendarId")! } : {}),
    eventId: idField(input, "eventId"),
    patch: normalizedPatch
  };
}

function validateCalendarDeleteInput(input: Record<string, unknown>): CalendarDeleteInput {
  rejectUnknownFields(input, ["calendarId", "eventId"]);
  const calendarId = optionalIdField(input, "calendarId");
  return {
    ...(calendarId ? { calendarId } : {}),
    eventId: idField(input, "eventId")
  };
}

export function validateGoogleCapabilityInput(capabilityId: string, input: unknown): GoogleReadCapabilityInput {
  const object = expectObject(input);
  switch (capabilityId) {
    case "google.gmail.search": {
      rejectUnknownFields(object, ["query", "limit"]);
      return {
        query: stringField(object, "query", { required: true, maxLength: 512 })!,
        limit: limitField(object)
      };
    }
    case "google.gmail.read": {
      rejectUnknownFields(object, ["messageId", "threadId"]);
      const messageId = optionalIdField(object, "messageId");
      const threadId = optionalIdField(object, "threadId");
      if ((messageId && threadId) || (!messageId && !threadId)) {
        throw new GoogleCapabilityInputError("Provide exactly one of messageId or threadId.");
      }
      return { ...(messageId ? { messageId } : {}), ...(threadId ? { threadId } : {}) };
    }
    case "google.calendar.list": {
      rejectUnknownFields(object, ["timeMin", "timeMax", "calendarId", "limit"]);
      return {
        ...(isoLikeField(object, "timeMin") ? { timeMin: isoLikeField(object, "timeMin") } : {}),
        ...(isoLikeField(object, "timeMax") ? { timeMax: isoLikeField(object, "timeMax") } : {}),
        ...(optionalIdField(object, "calendarId") ? { calendarId: optionalIdField(object, "calendarId") } : {}),
        limit: limitField(object)
      };
    }
    case "google.drive.search": {
      rejectUnknownFields(object, ["query", "mimeType", "limit"]);
      const query = stringField(object, "query", { maxLength: 512 });
      const mimeType = stringField(object, "mimeType", { maxLength: 128, pattern: MIME_PATTERN });
      return { ...(query ? { query } : {}), ...(mimeType ? { mimeType } : {}), limit: limitField(object) };
    }
    case "google.drive.read": {
      rejectUnknownFields(object, ["fileId", "exportMimeType"]);
      const exportMimeType = stringField(object, "exportMimeType", { maxLength: 128, pattern: MIME_PATTERN });
      return { fileId: idField(object, "fileId"), ...(exportMimeType ? { exportMimeType } : {}) };
    }
    case "google.docs.read": {
      rejectUnknownFields(object, ["documentId", "format"]);
      return {
        documentId: idField(object, "documentId"),
        format: enumField(object, "format", ["text", "markdown", "html"] as const, "text")
      };
    }
    case "google.docs.export": {
      rejectUnknownFields(object, ["documentId", "format"]);
      return {
        documentId: idField(object, "documentId"),
        format: enumField(object, "format", ["txt", "md", "html", "pdf"] as const, "txt")
      };
    }
    case "google.contacts.search": {
      rejectUnknownFields(object, ["query", "limit"]);
      return {
        query: stringField(object, "query", { required: true, maxLength: 512 })!,
        limit: limitField(object)
      };
    }
    default:
      throw new GoogleCapabilityInputError(`Capability ${capabilityId} is not enabled for gog execution in G2.`);
  }
}

export function validateGoogleNativeCapabilityInput(capabilityId: string, input: unknown): GoogleNativeCapabilityInput {
  const object = expectObject(input);
  switch (capabilityId) {
    case "google.gmail.draft":
    case "google.gmail.send":
      return validateGmailWriteInput(capabilityId, object);
    case "google.calendar.create":
      return validateCalendarCreateInput(object);
    case "google.calendar.update":
      return validateCalendarUpdateInput(object);
    case "google.calendar.delete":
      return validateCalendarDeleteInput(object);
    default:
      return validateGoogleCapabilityInput(capabilityId, input);
  }
}

export function serviceAuthError(service: GoogleService): string {
  return `gog is not authorized for ${service}.`;
}
