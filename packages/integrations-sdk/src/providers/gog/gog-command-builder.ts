import { getGoogleCapability, type GoogleService } from "../../google-capabilities.js";
import {
  GOOGLE_G2_WRITE_BLOCKED_CAPABILITY_IDS,
  isG2ReadCapabilityId,
  validateGoogleCapabilityInput,
  type CalendarListInput,
  type ContactsSearchInput,
  type DocsExportInput,
  type DocsReadInput,
  type DriveReadInput,
  type DriveSearchInput,
  type GmailReadInput,
  type GmailSearchInput
} from "../../google-capability-inputs.js";

export type GogOutputParserId =
  | "gmail.search"
  | "gmail.message"
  | "calendar.list"
  | "drive.search"
  | "drive.read"
  | "docs.read"
  | "contacts.search";

export interface GogCommandSpec {
  capabilityId: string;
  service: GoogleService;
  action: string;
  args: string[];
  timeoutMs?: number;
  maxStdoutBytes?: number;
  parser: GogOutputParserId;
  redaction?: {
    redactArgs?: string[];
  };
}

export class GogCommandBuilderError extends Error {
  status: "not_supported" | "blocked";

  constructor(message: string, status: "not_supported" | "blocked" = "not_supported") {
    super(message);
    this.name = "GogCommandBuilderError";
    this.status = status;
  }
}

function redactValues(...values: Array<string | undefined>): string[] {
  return values.filter((value): value is string => Boolean(value));
}

export function buildGogCommand(capabilityId: string, input: unknown): GogCommandSpec {
  const capability = getGoogleCapability(capabilityId);
  if (!capability) {
    throw new GogCommandBuilderError(`Unknown Google capability: ${capabilityId}`);
  }
  if (!capability.supportedBackends.includes("gog")) {
    throw new GogCommandBuilderError(`Capability ${capabilityId} does not support gog.`);
  }
  if ((GOOGLE_G2_WRITE_BLOCKED_CAPABILITY_IDS as readonly string[]).includes(capabilityId)) {
    throw new GogCommandBuilderError(`Capability ${capabilityId} requires policy and approval before gog execution.`, "blocked");
  }
  if (!isG2ReadCapabilityId(capabilityId)) {
    throw new GogCommandBuilderError(`Capability ${capabilityId} is not enabled for gog execution in G2.`);
  }

  const validated = validateGoogleCapabilityInput(capabilityId, input);
  switch (capabilityId) {
    case "google.gmail.search": {
      const value = validated as GmailSearchInput;
      return {
        capabilityId,
        service: "gmail",
        action: "search",
        args: ["gmail", "search", "--query", value.query, "--limit", String(value.limit ?? 10), "--json"],
        parser: "gmail.search",
        redaction: { redactArgs: redactValues(value.query) }
      };
    }
    case "google.gmail.read": {
      const value = validated as GmailReadInput;
      const idArgs = value.messageId ? ["--message-id", value.messageId] : ["--thread-id", value.threadId!];
      return {
        capabilityId,
        service: "gmail",
        action: "read",
        args: ["gmail", "read", ...idArgs, "--json"],
        parser: "gmail.message",
        redaction: { redactArgs: redactValues(value.messageId, value.threadId) }
      };
    }
    case "google.calendar.list": {
      const value = validated as CalendarListInput;
      return {
        capabilityId,
        service: "calendar",
        action: "list",
        args: [
          "calendar",
          "list",
          "--calendar-id",
          value.calendarId ?? "primary",
          "--from",
          value.timeMin ?? "today",
          "--to",
          value.timeMax ?? "tomorrow",
          "--limit",
          String(value.limit ?? 10),
          "--json"
        ],
        parser: "calendar.list",
        redaction: { redactArgs: redactValues(value.calendarId) }
      };
    }
    case "google.drive.search": {
      const value = validated as DriveSearchInput;
      const args = ["drive", "search"];
      if (value.query) args.push("--query", value.query);
      if (value.mimeType) args.push("--mime-type", value.mimeType);
      args.push("--limit", String(value.limit ?? 10), "--json");
      return {
        capabilityId,
        service: "drive",
        action: "search",
        args,
        parser: "drive.search",
        redaction: { redactArgs: redactValues(value.query) }
      };
    }
    case "google.drive.read": {
      const value = validated as DriveReadInput;
      const args = ["drive", "read", "--file-id", value.fileId, "--json"];
      if (value.exportMimeType) args.splice(args.length - 1, 0, "--export-mime-type", value.exportMimeType);
      return {
        capabilityId,
        service: "drive",
        action: "read",
        args,
        parser: "drive.read",
        redaction: { redactArgs: redactValues(value.fileId) }
      };
    }
    case "google.docs.read": {
      const value = validated as DocsReadInput;
      return {
        capabilityId,
        service: "docs",
        action: "read",
        args: ["docs", "read", "--document-id", value.documentId, "--format", value.format ?? "text", "--json"],
        parser: "docs.read",
        redaction: { redactArgs: redactValues(value.documentId) }
      };
    }
    case "google.docs.export": {
      const value = validated as DocsExportInput;
      return {
        capabilityId,
        service: "docs",
        action: "export",
        args: ["docs", "export", "--document-id", value.documentId, "--format", value.format ?? "txt", "--json"],
        parser: "docs.read",
        redaction: { redactArgs: redactValues(value.documentId) },
        ...(value.format === "pdf" ? { maxStdoutBytes: 2 * 1024 * 1024 } : {})
      };
    }
    case "google.contacts.search": {
      const value = validated as ContactsSearchInput;
      return {
        capabilityId,
        service: "contacts",
        action: "search",
        args: ["contacts", "search", "--query", value.query, "--limit", String(value.limit ?? 10), "--json"],
        parser: "contacts.search",
        redaction: { redactArgs: redactValues(value.query) }
      };
    }
    default:
      throw new GogCommandBuilderError(`Capability ${capabilityId} is not enabled for gog execution in G2.`);
  }
}
