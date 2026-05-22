export type GoogleBackend = "gog" | "native";

export type GoogleService =
  | "gmail"
  | "calendar"
  | "drive"
  | "docs"
  | "sheets"
  | "contacts";

export type GoogleEffect =
  | "read"
  | "read_sensitive"
  | "external_write"
  | "destructive";

export type GoogleSensitivity =
  | "low"
  | "medium"
  | "high"
  | "critical";

export type GoogleCapabilityStatus = "planned" | "stubbed" | "available";

export interface GoogleCapabilityDefinition {
  id: string;
  service: GoogleService;
  action: string;
  effect: GoogleEffect;
  sensitivity: GoogleSensitivity;
  requiresApproval: boolean;
  supportedBackends: GoogleBackend[];
  nativeScopes?: string[];
  gogServices?: GoogleService[];
  status: GoogleCapabilityStatus;
  description: string;
}

const ALL_BACKENDS: GoogleBackend[] = ["gog", "native"];

export const GOOGLE_SERVICE_LABELS: Record<GoogleService, string> = {
  gmail: "Gmail",
  calendar: "Calendar",
  drive: "Drive",
  docs: "Docs",
  sheets: "Sheets",
  contacts: "Contacts"
};

export const GOOGLE_SERVICES: GoogleService[] = [
  "gmail",
  "calendar",
  "drive",
  "docs",
  "sheets",
  "contacts"
];

export const GOOGLE_CAPABILITY_REGISTRY: GoogleCapabilityDefinition[] = [
  {
    id: "google.gmail.search",
    service: "gmail",
    action: "search",
    effect: "read",
    sensitivity: "medium",
    requiresApproval: false,
    supportedBackends: ALL_BACKENDS,
    nativeScopes: ["https://www.googleapis.com/auth/gmail.readonly"],
    gogServices: ["gmail"],
    status: "stubbed",
    description: "Search Gmail messages and threads through the governed Google router."
  },
  {
    id: "google.gmail.read",
    service: "gmail",
    action: "read",
    effect: "read_sensitive",
    sensitivity: "high",
    requiresApproval: false,
    supportedBackends: ALL_BACKENDS,
    nativeScopes: ["https://www.googleapis.com/auth/gmail.readonly"],
    gogServices: ["gmail"],
    status: "stubbed",
    description: "Read Gmail content as sensitive external data."
  },
  {
    id: "google.gmail.draft",
    service: "gmail",
    action: "draft",
    effect: "external_write",
    sensitivity: "high",
    requiresApproval: true,
    supportedBackends: ALL_BACKENDS,
    nativeScopes: ["https://www.googleapis.com/auth/gmail.compose"],
    gogServices: ["gmail"],
    status: "stubbed",
    description: "Create Gmail drafts after policy and approval checks."
  },
  {
    id: "google.gmail.send",
    service: "gmail",
    action: "send",
    effect: "external_write",
    sensitivity: "critical",
    requiresApproval: true,
    supportedBackends: ALL_BACKENDS,
    nativeScopes: ["https://www.googleapis.com/auth/gmail.send"],
    gogServices: ["gmail"],
    status: "stubbed",
    description: "Send Gmail messages after explicit approval."
  },
  {
    id: "google.calendar.list",
    service: "calendar",
    action: "list",
    effect: "read",
    sensitivity: "medium",
    requiresApproval: false,
    supportedBackends: ALL_BACKENDS,
    nativeScopes: ["https://www.googleapis.com/auth/calendar.readonly"],
    gogServices: ["calendar"],
    status: "stubbed",
    description: "List Google Calendar events."
  },
  {
    id: "google.calendar.create",
    service: "calendar",
    action: "create",
    effect: "external_write",
    sensitivity: "high",
    requiresApproval: true,
    supportedBackends: ALL_BACKENDS,
    nativeScopes: ["https://www.googleapis.com/auth/calendar"],
    gogServices: ["calendar"],
    status: "stubbed",
    description: "Create Google Calendar events after approval."
  },
  {
    id: "google.calendar.update",
    service: "calendar",
    action: "update",
    effect: "external_write",
    sensitivity: "high",
    requiresApproval: true,
    supportedBackends: ALL_BACKENDS,
    nativeScopes: ["https://www.googleapis.com/auth/calendar"],
    gogServices: ["calendar"],
    status: "stubbed",
    description: "Update Google Calendar events after approval."
  },
  {
    id: "google.calendar.delete",
    service: "calendar",
    action: "delete",
    effect: "destructive",
    sensitivity: "critical",
    requiresApproval: true,
    supportedBackends: ALL_BACKENDS,
    nativeScopes: ["https://www.googleapis.com/auth/calendar"],
    gogServices: ["calendar"],
    status: "stubbed",
    description: "Delete Google Calendar events after explicit approval."
  },
  {
    id: "google.drive.search",
    service: "drive",
    action: "search",
    effect: "read",
    sensitivity: "medium",
    requiresApproval: false,
    supportedBackends: ALL_BACKENDS,
    nativeScopes: ["https://www.googleapis.com/auth/drive.readonly"],
    gogServices: ["drive"],
    status: "stubbed",
    description: "Search Google Drive metadata through the governed router."
  },
  {
    id: "google.drive.read",
    service: "drive",
    action: "read",
    effect: "read_sensitive",
    sensitivity: "high",
    requiresApproval: false,
    supportedBackends: ALL_BACKENDS,
    nativeScopes: ["https://www.googleapis.com/auth/drive.readonly"],
    gogServices: ["drive"],
    status: "stubbed",
    description: "Read Google Drive file content as sensitive external data."
  },
  {
    id: "google.docs.read",
    service: "docs",
    action: "read",
    effect: "read_sensitive",
    sensitivity: "high",
    requiresApproval: false,
    supportedBackends: ALL_BACKENDS,
    nativeScopes: ["https://www.googleapis.com/auth/documents.readonly"],
    gogServices: ["docs"],
    status: "stubbed",
    description: "Read Google Docs content as sensitive external data."
  },
  {
    id: "google.docs.export",
    service: "docs",
    action: "export",
    effect: "read_sensitive",
    sensitivity: "high",
    requiresApproval: false,
    supportedBackends: ALL_BACKENDS,
    nativeScopes: ["https://www.googleapis.com/auth/documents.readonly"],
    gogServices: ["docs"],
    status: "stubbed",
    description: "Export Google Docs content through a governed provider."
  },
  {
    id: "google.docs.copy",
    service: "docs",
    action: "copy",
    effect: "external_write",
    sensitivity: "high",
    requiresApproval: true,
    supportedBackends: ALL_BACKENDS,
    nativeScopes: ["https://www.googleapis.com/auth/documents", "https://www.googleapis.com/auth/drive.file"],
    gogServices: ["docs", "drive"],
    status: "stubbed",
    description: "Copy Google Docs after approval."
  },
  {
    id: "google.sheets.read",
    service: "sheets",
    action: "read",
    effect: "read_sensitive",
    sensitivity: "high",
    requiresApproval: false,
    supportedBackends: ALL_BACKENDS,
    nativeScopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
    gogServices: ["sheets"],
    status: "stubbed",
    description: "Read Google Sheets values as sensitive external data."
  },
  {
    id: "google.sheets.append",
    service: "sheets",
    action: "append",
    effect: "external_write",
    sensitivity: "high",
    requiresApproval: true,
    supportedBackends: ALL_BACKENDS,
    nativeScopes: ["https://www.googleapis.com/auth/spreadsheets"],
    gogServices: ["sheets"],
    status: "stubbed",
    description: "Append Google Sheets values after approval."
  },
  {
    id: "google.sheets.update",
    service: "sheets",
    action: "update",
    effect: "external_write",
    sensitivity: "high",
    requiresApproval: true,
    supportedBackends: ALL_BACKENDS,
    nativeScopes: ["https://www.googleapis.com/auth/spreadsheets"],
    gogServices: ["sheets"],
    status: "stubbed",
    description: "Update Google Sheets values after approval."
  },
  {
    id: "google.contacts.search",
    service: "contacts",
    action: "search",
    effect: "read_sensitive",
    sensitivity: "high",
    requiresApproval: false,
    supportedBackends: ALL_BACKENDS,
    nativeScopes: ["https://www.googleapis.com/auth/contacts.readonly"],
    gogServices: ["contacts"],
    status: "stubbed",
    description: "Search Google Contacts as sensitive external data."
  }
];

const GOOGLE_CAPABILITIES_BY_ID = new Map(
  GOOGLE_CAPABILITY_REGISTRY.map((capability) => [capability.id, capability])
);

export function getGoogleCapability(id: string): GoogleCapabilityDefinition | undefined {
  return GOOGLE_CAPABILITIES_BY_ID.get(id);
}

export function listGoogleCapabilities(): GoogleCapabilityDefinition[] {
  return [...GOOGLE_CAPABILITY_REGISTRY];
}

export function listGoogleCapabilitiesByService(service: GoogleService): GoogleCapabilityDefinition[] {
  return GOOGLE_CAPABILITY_REGISTRY.filter((capability) => capability.service === service);
}

export function isGoogleCapability(id: string): boolean {
  return GOOGLE_CAPABILITIES_BY_ID.has(id);
}

export function requiresGoogleApproval(id: string): boolean {
  return getGoogleCapability(id)?.requiresApproval ?? false;
}

export function getSupportedGoogleBackends(id: string): GoogleBackend[] {
  return [...(getGoogleCapability(id)?.supportedBackends ?? [])];
}
