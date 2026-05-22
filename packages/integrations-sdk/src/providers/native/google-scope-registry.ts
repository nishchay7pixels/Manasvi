import { getGoogleCapability, listGoogleCapabilities, type GoogleService } from "../../google-capabilities.js";

export const GOOGLE_SCOPE_REGISTRY = {
  "google.gmail.search": ["https://www.googleapis.com/auth/gmail.readonly"],
  "google.gmail.read": ["https://www.googleapis.com/auth/gmail.readonly"],
  "google.gmail.draft": ["https://www.googleapis.com/auth/gmail.compose"],
  "google.gmail.send": ["https://www.googleapis.com/auth/gmail.send"],
  "google.calendar.list": ["https://www.googleapis.com/auth/calendar.readonly"],
  "google.calendar.create": ["https://www.googleapis.com/auth/calendar.events"],
  "google.calendar.update": ["https://www.googleapis.com/auth/calendar.events"],
  "google.calendar.delete": ["https://www.googleapis.com/auth/calendar.events"],
  "google.drive.search": ["https://www.googleapis.com/auth/drive.readonly"],
  "google.drive.read": ["https://www.googleapis.com/auth/drive.readonly"],
  "google.docs.read": ["https://www.googleapis.com/auth/documents.readonly"],
  "google.docs.export": ["https://www.googleapis.com/auth/documents.readonly"],
  "google.docs.copy": ["https://www.googleapis.com/auth/documents", "https://www.googleapis.com/auth/drive.file"],
  "google.sheets.read": ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  "google.sheets.append": ["https://www.googleapis.com/auth/spreadsheets"],
  "google.sheets.update": ["https://www.googleapis.com/auth/spreadsheets"],
  "google.contacts.search": ["https://www.googleapis.com/auth/contacts.readonly"]
} as const satisfies Record<string, readonly string[]>;

export type GoogleNativeCapabilityId = keyof typeof GOOGLE_SCOPE_REGISTRY;

const SCOPE_ALIASES: Record<string, readonly string[]> = {
  "https://www.googleapis.com/auth/calendar": ["https://www.googleapis.com/auth/calendar.readonly", "https://www.googleapis.com/auth/calendar.events"],
  "https://www.googleapis.com/auth/gmail.modify": ["https://www.googleapis.com/auth/gmail.readonly"]
};

export function getRequiredScopesForCapability(capabilityId: string): string[] {
  const capability = getGoogleCapability(capabilityId);
  if (!capability || !(capabilityId in GOOGLE_SCOPE_REGISTRY)) {
    throw new Error(`Unknown Google native capability: ${capabilityId}`);
  }
  return [...GOOGLE_SCOPE_REGISTRY[capabilityId as GoogleNativeCapabilityId]];
}

function grantedIncludes(requiredScope: string, grantedScopes: string[]): boolean {
  if (grantedScopes.includes(requiredScope)) return true;
  return grantedScopes.some((scope) => SCOPE_ALIASES[scope]?.includes(requiredScope));
}

export function getMissingScopes(capabilityId: string, grantedScopes: string[]): string[] {
  return getRequiredScopesForCapability(capabilityId).filter((scope) => !grantedIncludes(scope, grantedScopes));
}

export function hasRequiredScopes(capabilityId: string, grantedScopes: string[]): boolean {
  return getMissingScopes(capabilityId, grantedScopes).length === 0;
}

export function listScopesByService(service: GoogleService): string[] {
  const scopes = new Set<string>();
  for (const capability of listGoogleCapabilities().filter((item) => item.service === service)) {
    for (const scope of getRequiredScopesForCapability(capability.id)) {
      scopes.add(scope);
    }
  }
  return [...scopes];
}

export function listDefaultNativeGoogleScopes(): string[] {
  return [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.compose",
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/calendar.readonly",
    "https://www.googleapis.com/auth/calendar.events"
  ];
}
