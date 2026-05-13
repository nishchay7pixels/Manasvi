import type { IntegrationAccountRecord } from "./index.js";
import { deriveGoogleCapabilities, type GoogleCapabilityId } from "./permissions.js";

// ── Calendar health/status types ──────────────────────────────────────────────

export type CalendarIntegrationHealthStatus =
  | "connected"
  | "authorized_read"
  | "degraded"
  | "token_refresh_needed"
  | "refresh_failed"
  | "disconnected"
  | "error";

export interface CalendarConnectorHealth {
  providerId: "google";
  connectorId: string;
  accountId: string | null;
  status: CalendarIntegrationHealthStatus;
  connected: boolean;
  calendarReadAuthorized: boolean;
  requiredCapabilities: GoogleCapabilityId[];
  availableCapabilities: GoogleCapabilityId[];
  missingCapabilities: GoogleCapabilityId[];
  tokenPresent: boolean;
  tokenExpiresAt: string | null;
  providerReachable: boolean;
  lastSuccessfulReadAt: string | null;
  lastError: string | null;
}

// ── Normalized Calendar entity types ─────────────────────────────────────────

export interface CalendarSummary {
  calendarId: string;
  displayName: string;
  description: string | null;
  isPrimary: boolean;
  accessRole: string | null;
  timezone: string | null;
  selected: boolean;
  hidden: boolean;
  backgroundColor: string | null;
  connectorId: string;
  accountId: string;
}

export interface CalendarEventAttendee {
  email: string;
  displayName: string | null;
  responseStatus: "accepted" | "declined" | "tentative" | "needsAction" | null;
  self: boolean;
  organizer: boolean;
}

export interface CalendarEventDateTime {
  dateTime: string | null;
  date: string | null;
  timeZone: string | null;
}

export interface CalendarEventSummary {
  eventId: string;
  calendarId: string;
  title: string;
  description: string | null;
  location: string | null;
  start: CalendarEventDateTime;
  end: CalendarEventDateTime;
  allDay: boolean;
  startIso: string;
  endIso: string;
  timezone: string | null;
  status: string | null;
  attendeeCount: number;
  hasAttendees: boolean;
  organizerEmail: string | null;
  organizerName: string | null;
  hasMeetingLink: boolean;
  meetingLink: string | null;
  isRecurring: boolean;
  recurringEventId: string | null;
  connectorId: string;
  accountId: string;
}

export interface CalendarEventDetail extends CalendarEventSummary {
  attendees: CalendarEventAttendee[];
  htmlLink: string | null;
  created: string | null;
  updated: string | null;
  provenance: {
    source: "google_calendar";
    trustClassification: "EXTERNAL_UNTRUSTED";
    provider: "google";
    connectorId: string;
    accountId: string;
    calendarId: string;
    eventId: string;
    fetchedAt: string;
  };
}

export interface CalendarListResult {
  calendars: CalendarSummary[];
  nextPageToken: string | null;
}

export interface CalendarEventListQuery {
  calendarId?: string;
  timeMin?: string;
  timeMax?: string;
  maxResults?: number;
  pageToken?: string;
  singleEvents?: boolean;
  orderBy?: "startTime" | "updated";
  query?: string;
  showDeleted?: boolean;
}

export interface CalendarEventListResult {
  events: CalendarEventSummary[];
  nextPageToken: string | null;
  timeZone: string | null;
  calendarId: string;
}

export interface CalendarBusyBlock {
  start: string;
  end: string;
}

export interface CalendarFreeSlot {
  start: string;
  end: string;
  durationMinutes: number;
}

export interface CalendarAvailabilityResult {
  calendarId: string;
  timeMin: string;
  timeMax: string;
  timezone: string | null;
  busyBlocks: CalendarBusyBlock[];
  freeSlots: CalendarFreeSlot[];
  isFreeAt: boolean | null;
  totalBusyMinutes: number;
  totalFreeMinutes: number;
}

export interface CalendarUpcomingResult {
  calendarId: string;
  fetchedAt: string;
  timezone: string | null;
  events: CalendarEventSummary[];
  totalCount: number;
  hasMore: boolean;
}

export interface CalendarReadIngressRecord {
  sourceId: string;
  sourceType: "calendar_event";
  title: string;
  content: string;
  contentPreview: string;
  trustClassification: "EXTERNAL_UNTRUSTED";
  provenance: CalendarEventDetail["provenance"];
  metadata: {
    calendarId: string;
    eventId: string;
    startIso: string;
    endIso: string;
    allDay: boolean;
    hasAttendees: boolean;
    attendeeCount: number;
    location: string | null;
    hasMeetingLink: boolean;
  };
}

// ── Google Calendar API raw types ─────────────────────────────────────────────

interface GoogleCalendarListEntry {
  id: string;
  summary?: string;
  description?: string;
  primary?: boolean;
  accessRole?: string;
  timeZone?: string;
  selected?: boolean;
  hidden?: boolean;
  backgroundColor?: string;
}

interface GoogleCalendarListResponse {
  items?: GoogleCalendarListEntry[];
  nextPageToken?: string;
}

interface GoogleCalendarEventCreator {
  email?: string;
  displayName?: string;
}

interface GoogleCalendarEventOrganizer {
  email?: string;
  displayName?: string;
  self?: boolean;
}

interface GoogleCalendarEventAttendeeRaw {
  email?: string;
  displayName?: string;
  responseStatus?: string;
  self?: boolean;
  organizer?: boolean;
}

interface GoogleCalendarEventDateTime {
  dateTime?: string;
  date?: string;
  timeZone?: string;
}

interface GoogleCalendarConferenceEntryPoint {
  entryPointType?: string;
  uri?: string;
  label?: string;
}

interface GoogleCalendarConferenceData {
  entryPoints?: GoogleCalendarConferenceEntryPoint[];
}

interface GoogleCalendarEvent {
  id: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: GoogleCalendarEventDateTime;
  end?: GoogleCalendarEventDateTime;
  status?: string;
  attendees?: GoogleCalendarEventAttendeeRaw[];
  organizer?: GoogleCalendarEventOrganizer;
  creator?: GoogleCalendarEventCreator;
  htmlLink?: string;
  hangoutLink?: string;
  conferenceData?: GoogleCalendarConferenceData;
  created?: string;
  updated?: string;
  recurringEventId?: string;
}

interface GoogleCalendarEventsResponse {
  items?: GoogleCalendarEvent[];
  nextPageToken?: string;
  timeZone?: string;
}

interface GoogleFreeBusyRequestItem {
  id: string;
}

interface GoogleFreeBusyResponse {
  calendars?: Record<string, { busy?: Array<{ start: string; end: string }> }>;
  timeZone?: string;
}

// ── Calendar API client ───────────────────────────────────────────────────────

export interface CalendarApiClient {
  get<T>(url: string, accessToken: string): Promise<T>;
  post<T>(url: string, body: Record<string, unknown>, accessToken: string): Promise<T>;
  patch<T>(url: string, body: Record<string, unknown>, accessToken: string): Promise<T>;
  delete_(url: string, accessToken: string): Promise<void>;
}

export class FetchCalendarApiClient implements CalendarApiClient {
  async get<T>(url: string, accessToken: string): Promise<T> {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json"
      }
    });
    if (!response.ok) {
      const upstreamBody = await response.text().catch(() => "");
      const detail = upstreamBody.trim().slice(0, 600);
      throw new Error(
        `Calendar API read failed (${response.status})${detail ? `: ${detail}` : ""}`
      );
    }
    return (await response.json()) as T;
  }

  async post<T>(url: string, body: Record<string, unknown>, accessToken: string): Promise<T> {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json"
      },
      body: JSON.stringify(body)
    });
    if (!response.ok) {
      const upstreamBody = await response.text().catch(() => "");
      const detail = upstreamBody.trim().slice(0, 600);
      throw new Error(
        `Calendar API request failed (${response.status})${detail ? `: ${detail}` : ""}`
      );
    }
    return (await response.json()) as T;
  }

  async patch<T>(url: string, body: Record<string, unknown>, accessToken: string): Promise<T> {
    const response = await fetch(url, {
      method: "PATCH",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json"
      },
      body: JSON.stringify(body)
    });
    if (!response.ok) {
      const upstreamBody = await response.text().catch(() => "");
      const detail = upstreamBody.trim().slice(0, 600);
      throw new Error(
        `Calendar API write failed (${response.status})${detail ? `: ${detail}` : ""}`
      );
    }
    return (await response.json()) as T;
  }

  async delete_(url: string, accessToken: string): Promise<void> {
    const response = await fetch(url, {
      method: "DELETE",
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });
    if (!response.ok) {
      const upstreamBody = await response.text().catch(() => "");
      const detail = upstreamBody.trim().slice(0, 600);
      throw new Error(
        `Calendar API write failed (${response.status})${detail ? `: ${detail}` : ""}`
      );
    }
  }
}

// ── Normalization helpers ─────────────────────────────────────────────────────

function normalizeEventDateTime(dt: GoogleCalendarEventDateTime | undefined): CalendarEventDateTime {
  return {
    dateTime: dt?.dateTime ?? null,
    date: dt?.date ?? null,
    timeZone: dt?.timeZone ?? null
  };
}

function resolveIsoStart(dt: GoogleCalendarEventDateTime | undefined): string {
  if (dt?.dateTime) return dt.dateTime;
  if (dt?.date) return `${dt.date}T00:00:00`;
  return new Date().toISOString();
}

function resolveIsoEnd(dt: GoogleCalendarEventDateTime | undefined): string {
  if (dt?.dateTime) return dt.dateTime;
  if (dt?.date) return `${dt.date}T23:59:59`;
  return new Date().toISOString();
}

function isAllDayEvent(event: GoogleCalendarEvent): boolean {
  return Boolean(event.start?.date && !event.start.dateTime);
}

function getDatePartsInTimeZone(date: Date, timeZone: string): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  const day = Number(parts.find((part) => part.type === "day")?.value);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    throw new Error(`Failed to resolve date parts for timezone '${timeZone}'.`);
  }
  return { year, month, day };
}

function parseTimeZoneOffsetMinutes(date: Date, timeZone: string): number {
  const tzPart = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "shortOffset",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  })
    .formatToParts(date)
    .find((part) => part.type === "timeZoneName")
    ?.value;
  if (!tzPart || tzPart === "GMT" || tzPart === "UTC") {
    return 0;
  }
  const match = tzPart.match(/^(?:GMT|UTC)([+-])(\d{1,2})(?::?(\d{2}))?$/);
  if (!match) {
    return 0;
  }
  const sign = match[1] === "-" ? -1 : 1;
  const hours = Number(match[2] ?? "0");
  const minutes = Number(match[3] ?? "0");
  return sign * (hours * 60 + minutes);
}

function localTimeInZoneToUtcIso(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timeZone: string
): string {
  const asUtc = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  const offsetMinutes = parseTimeZoneOffsetMinutes(asUtc, timeZone);
  return new Date(asUtc.getTime() - offsetMinutes * 60_000).toISOString();
}

function shiftYmd(year: number, month: number, day: number, offsetDays: number): { year: number; month: number; day: number } {
  if (offsetDays === 0) {
    return { year, month, day };
  }
  const shifted = new Date(Date.UTC(year, month - 1, day + offsetDays, 12, 0, 0));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate()
  };
}

function extractMeetingLink(event: GoogleCalendarEvent): string | null {
  if (event.hangoutLink) return event.hangoutLink;
  const entryPoints = event.conferenceData?.entryPoints ?? [];
  const videoEntry = entryPoints.find((ep) => ep.entryPointType === "video");
  return videoEntry?.uri ?? null;
}

function normalizeEventAttendees(raw: GoogleCalendarEventAttendeeRaw[]): CalendarEventAttendee[] {
  return raw.map((a) => ({
    email: a.email ?? "",
    displayName: a.displayName ?? null,
    responseStatus: (a.responseStatus as CalendarEventAttendee["responseStatus"]) ?? null,
    self: Boolean(a.self),
    organizer: Boolean(a.organizer)
  }));
}

function normalizeEventSummary(
  event: GoogleCalendarEvent,
  calendarId: string,
  account: IntegrationAccountRecord
): CalendarEventSummary {
  const startDt = normalizeEventDateTime(event.start);
  const endDt = normalizeEventDateTime(event.end);
  const startIso = resolveIsoStart(event.start);
  const endIso = resolveIsoEnd(event.end);
  const allDay = isAllDayEvent(event);
  const timezone = event.start?.timeZone ?? null;
  const meetingLink = extractMeetingLink(event);
  const attendees = event.attendees ?? [];

  return {
    eventId: event.id,
    calendarId,
    title: event.summary ?? "(no title)",
    description: event.description ? event.description.slice(0, 500) : null,
    location: event.location ?? null,
    start: startDt,
    end: endDt,
    allDay,
    startIso,
    endIso,
    timezone,
    status: event.status ?? null,
    attendeeCount: attendees.length,
    hasAttendees: attendees.length > 0,
    organizerEmail: event.organizer?.email ?? null,
    organizerName: event.organizer?.displayName ?? null,
    hasMeetingLink: Boolean(meetingLink),
    meetingLink,
    isRecurring: Boolean(event.recurringEventId),
    recurringEventId: event.recurringEventId ?? null,
    connectorId: account.connectorId,
    accountId: account.accountId
  };
}

function normalizeEventDetail(
  event: GoogleCalendarEvent,
  calendarId: string,
  account: IntegrationAccountRecord
): CalendarEventDetail {
  const summary = normalizeEventSummary(event, calendarId, account);
  const attendees = normalizeEventAttendees(event.attendees ?? []);

  return {
    ...summary,
    attendees,
    htmlLink: event.htmlLink ?? null,
    created: event.created ?? null,
    updated: event.updated ?? null,
    provenance: {
      source: "google_calendar",
      trustClassification: "EXTERNAL_UNTRUSTED",
      provider: "google",
      connectorId: account.connectorId,
      accountId: account.accountId,
      calendarId,
      eventId: event.id,
      fetchedAt: new Date().toISOString()
    }
  };
}

function normalizeCalendarSummary(
  entry: GoogleCalendarListEntry,
  account: IntegrationAccountRecord
): CalendarSummary {
  return {
    calendarId: entry.id,
    displayName: entry.summary ?? entry.id,
    description: entry.description ?? null,
    isPrimary: Boolean(entry.primary),
    accessRole: entry.accessRole ?? null,
    timezone: entry.timeZone ?? null,
    selected: entry.selected !== false,
    hidden: Boolean(entry.hidden),
    backgroundColor: entry.backgroundColor ?? null,
    connectorId: account.connectorId,
    accountId: account.accountId
  };
}

// ── Free/busy analysis helpers ────────────────────────────────────────────────

function computeFreeSlots(
  busyBlocks: CalendarBusyBlock[],
  windowStart: Date,
  windowEnd: Date,
  minSlotMinutes = 15
): CalendarFreeSlot[] {
  const sorted = [...busyBlocks].sort((a, b) => a.start.localeCompare(b.start));
  const slots: CalendarFreeSlot[] = [];
  let cursor = windowStart;

  for (const block of sorted) {
    const blockStart = new Date(block.start);
    const blockEnd = new Date(block.end);
    if (blockStart > cursor) {
      const durationMs = blockStart.getTime() - cursor.getTime();
      const durationMinutes = Math.floor(durationMs / 60000);
      if (durationMinutes >= minSlotMinutes) {
        slots.push({
          start: cursor.toISOString(),
          end: blockStart.toISOString(),
          durationMinutes
        });
      }
    }
    if (blockEnd > cursor) {
      cursor = blockEnd;
    }
  }

  if (cursor < windowEnd) {
    const durationMs = windowEnd.getTime() - cursor.getTime();
    const durationMinutes = Math.floor(durationMs / 60000);
    if (durationMinutes >= minSlotMinutes) {
      slots.push({
        start: cursor.toISOString(),
        end: windowEnd.toISOString(),
        durationMinutes
      });
    }
  }

  return slots;
}

function computeTotalBusyMinutes(busyBlocks: CalendarBusyBlock[], windowStart: Date, windowEnd: Date): number {
  let total = 0;
  for (const block of busyBlocks) {
    const start = Math.max(new Date(block.start).getTime(), windowStart.getTime());
    const end = Math.min(new Date(block.end).getTime(), windowEnd.getTime());
    if (end > start) total += end - start;
  }
  return Math.floor(total / 60000);
}

// ── Calendar write types ──────────────────────────────────────────────────────

export type CalendarWriteActionId =
  | "calendar.event.create"
  | "calendar.event.create_with_attendees"
  | "calendar.event.update"
  | "calendar.event.update_attendees"
  | "calendar.event.delete";

export interface CalendarAttendeeInput {
  email: string;
  displayName?: string;
}

export interface CalendarReminderInput {
  useDefault?: boolean | undefined;
  overrides?: Array<{ method: "email" | "popup"; minutes: number }> | undefined;
}

export interface CalendarCreateEventInput {
  calendarId?: string;
  summary: string;
  startDateTime: string;
  endDateTime: string;
  timeZone?: string;
  description?: string;
  location?: string;
  attendees?: CalendarAttendeeInput[];
  reminders?: CalendarReminderInput;
  visibility?: "default" | "public" | "private" | "confidential";
  guestsCanModify?: boolean;
  guestsCanInviteOthers?: boolean;
  sendNotifications?: boolean;
}

export interface CalendarUpdateEventInput {
  calendarId?: string;
  eventId: string;
  summary?: string;
  description?: string;
  location?: string;
  startDateTime?: string;
  endDateTime?: string;
  timeZone?: string;
  attendeesToAdd?: CalendarAttendeeInput[];
  attendeesToRemove?: string[];
  reminders?: CalendarReminderInput;
  visibility?: "default" | "public" | "private" | "confidential";
  sendNotifications?: boolean;
}

export interface CalendarDeleteEventInput {
  calendarId?: string;
  eventId: string;
  sendNotifications?: boolean;
}

export interface CalendarConflictCheckResult {
  calendarId: string;
  proposedStart: string;
  proposedEnd: string;
  hasConflict: boolean;
  conflicts: CalendarBusyBlock[];
  freeSlots: CalendarFreeSlot[];
  conflictSeverity: "none" | "soft" | "hard";
  warning: string | null;
}

export interface CalendarCreateEventResult {
  eventId: string;
  calendarId: string;
  htmlLink: string | null;
  status: string;
  summary: string;
  startIso: string;
  endIso: string;
  attendeeCount: number;
  hasAttendees: boolean;
  created: string | null;
  actionId: CalendarWriteActionId;
  connectorId: string;
  accountId: string;
  conflictCheck: CalendarConflictCheckResult | null;
}

export interface CalendarUpdateEventResult {
  eventId: string;
  calendarId: string;
  htmlLink: string | null;
  status: string;
  summary: string;
  startIso: string;
  endIso: string;
  attendeeCount: number;
  hasAttendees: boolean;
  updated: string | null;
  actionId: CalendarWriteActionId;
  connectorId: string;
  accountId: string;
  conflictCheck: CalendarConflictCheckResult | null;
}

export interface CalendarDeleteEventResult {
  eventId: string;
  calendarId: string;
  deleted: boolean;
  deletedAt: string;
  actionId: "calendar.event.delete";
  connectorId: string;
  accountId: string;
}

// ── CalendarReadConnector ─────────────────────────────────────────────────────

export class CalendarReadConnector {
  private lastSuccessfulReadAt: string | null = null;
  private lastError: string | null = null;

  private static readonly BASE_URL = "https://www.googleapis.com/calendar/v3";

  constructor(private readonly apiClient: CalendarApiClient) {}

  computeHealth(account: IntegrationAccountRecord | null, tokenPresent: boolean): CalendarConnectorHealth {
    if (!account) {
      return {
        providerId: "google",
        connectorId: "google-foundation",
        accountId: null,
        status: "disconnected",
        connected: false,
        calendarReadAuthorized: false,
        requiredCapabilities: ["calendar.read_events"],
        availableCapabilities: [],
        missingCapabilities: ["calendar.read_events"],
        tokenPresent: false,
        tokenExpiresAt: null,
        providerReachable: false,
        lastSuccessfulReadAt: this.lastSuccessfulReadAt,
        lastError: this.lastError
      };
    }

    const capabilities = deriveGoogleCapabilities(account.scopesGranted)
      .availableCapabilities.map((item) => item.capabilityId);
    const requiredCapabilities: GoogleCapabilityId[] = ["calendar.read_events"];
    const missingCapabilities = requiredCapabilities.filter((cap) => !capabilities.includes(cap));
    const calendarReadAuthorized = missingCapabilities.length === 0;

    let status: CalendarIntegrationHealthStatus = "connected";
    if (account.status === "refresh_failed") status = "refresh_failed";
    else if (account.status === "token_refresh_needed") status = "token_refresh_needed";
    else if (!calendarReadAuthorized) status = "degraded";
    else status = "authorized_read";

    return {
      providerId: "google",
      connectorId: account.connectorId,
      accountId: account.accountId,
      status,
      connected: account.status === "connected",
      calendarReadAuthorized,
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

  async listCalendars(
    accessToken: string,
    account: IntegrationAccountRecord,
    pageToken?: string
  ): Promise<CalendarListResult> {
    const params = new URLSearchParams({ minAccessRole: "reader" });
    if (pageToken) params.set("pageToken", pageToken);

    const url = `${CalendarReadConnector.BASE_URL}/users/me/calendarList?${params.toString()}`;
    const raw = await this.withErrorCapture<GoogleCalendarListResponse>(() =>
      this.apiClient.get<GoogleCalendarListResponse>(url, accessToken)
    );

    const calendars = (raw.items ?? []).map((entry) => normalizeCalendarSummary(entry, account));
    this.lastSuccessfulReadAt = new Date().toISOString();
    this.lastError = null;

    return {
      calendars,
      nextPageToken: raw.nextPageToken ?? null
    };
  }

  async listEvents(
    accessToken: string,
    account: IntegrationAccountRecord,
    query: CalendarEventListQuery = {}
  ): Promise<CalendarEventListResult> {
    const calendarId = query.calendarId ?? "primary";
    const params = new URLSearchParams();
    if (query.timeMin) params.set("timeMin", query.timeMin);
    if (query.timeMax) params.set("timeMax", query.timeMax);
    params.set("maxResults", String(Math.min(query.maxResults ?? 25, 100)));
    params.set("singleEvents", String(query.singleEvents !== false));
    params.set("orderBy", query.orderBy ?? "startTime");
    if (query.pageToken) params.set("pageToken", query.pageToken);
    if (query.query) params.set("q", query.query);
    if (query.showDeleted) params.set("showDeleted", "true");

    const url = `${CalendarReadConnector.BASE_URL}/calendars/${encodeURIComponent(calendarId)}/events?${params.toString()}`;
    const raw = await this.withErrorCapture<GoogleCalendarEventsResponse>(() =>
      this.apiClient.get<GoogleCalendarEventsResponse>(url, accessToken)
    );

    const events = (raw.items ?? []).map((event) =>
      normalizeEventSummary(event, calendarId, account)
    );
    this.lastSuccessfulReadAt = new Date().toISOString();
    this.lastError = null;

    return {
      events,
      nextPageToken: raw.nextPageToken ?? null,
      timeZone: raw.timeZone ?? null,
      calendarId
    };
  }

  async getEvent(
    accessToken: string,
    account: IntegrationAccountRecord,
    calendarId: string,
    eventId: string
  ): Promise<CalendarEventDetail> {
    const url = `${CalendarReadConnector.BASE_URL}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`;
    const raw = await this.withErrorCapture<GoogleCalendarEvent>(() =>
      this.apiClient.get<GoogleCalendarEvent>(url, accessToken)
    );
    this.lastSuccessfulReadAt = new Date().toISOString();
    this.lastError = null;
    return normalizeEventDetail(raw, calendarId, account);
  }

  async getTodayEvents(
    accessToken: string,
    account: IntegrationAccountRecord,
    calendarId = "primary",
    timezone?: string,
    date?: string,
    dayOffset = 0
  ): Promise<CalendarEventListResult> {
    const tz = timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC";
    const normalizedOffset = Number.isFinite(dayOffset) ? Math.trunc(dayOffset) : 0;
    let year: number;
    let month: number;
    let day: number;
    if (date) {
      const m = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (!m) {
        throw new Error("Invalid date format. Expected YYYY-MM-DD.");
      }
      year = Number(m[1]);
      month = Number(m[2]);
      day = Number(m[3]);
      ({ year, month, day } = shiftYmd(year, month, day, normalizedOffset));
    } else {
      const now = new Date();
      ({ year, month, day } = getDatePartsInTimeZone(now, tz));
      ({ year, month, day } = shiftYmd(year, month, day, normalizedOffset));
    }

    const timeMin = localTimeInZoneToUtcIso(year, month, day, 0, 0, 0, tz);
    const timeMax = localTimeInZoneToUtcIso(year, month, day, 23, 59, 59, tz);

    return this.listEvents(accessToken, account, {
      calendarId,
      timeMin,
      timeMax,
      maxResults: 50,
      singleEvents: true,
      orderBy: "startTime"
    });
  }

  async getUpcomingEvents(
    accessToken: string,
    account: IntegrationAccountRecord,
    calendarId = "primary",
    maxResults = 10
  ): Promise<CalendarUpcomingResult> {
    const now = new Date().toISOString();
    const result = await this.listEvents(accessToken, account, {
      calendarId,
      timeMin: now,
      maxResults: maxResults + 1,
      singleEvents: true,
      orderBy: "startTime"
    });

    const hasMore = result.events.length > maxResults;
    const events = hasMore ? result.events.slice(0, maxResults) : result.events;

    return {
      calendarId,
      fetchedAt: new Date().toISOString(),
      timezone: result.timeZone,
      events,
      totalCount: events.length,
      hasMore
    };
  }

  async checkAvailability(
    accessToken: string,
    _account: IntegrationAccountRecord,
    calendarId: string,
    timeMin: string,
    timeMax: string,
    checkTimeIso?: string
  ): Promise<CalendarAvailabilityResult> {
    const url = `${CalendarReadConnector.BASE_URL}/freeBusy`;
    const body: Record<string, unknown> = {
      timeMin,
      timeMax,
      items: [{ id: calendarId } as GoogleFreeBusyRequestItem]
    };

    const raw = await this.withErrorCapture<GoogleFreeBusyResponse>(() =>
      this.apiClient.post<GoogleFreeBusyResponse>(url, body, accessToken)
    );

    const calBusy = raw.calendars?.[calendarId]?.busy ?? [];
    const busyBlocks: CalendarBusyBlock[] = calBusy.map((b) => ({
      start: b.start,
      end: b.end
    }));

    const windowStart = new Date(timeMin);
    const windowEnd = new Date(timeMax);
    const freeSlots = computeFreeSlots(busyBlocks, windowStart, windowEnd);
    const totalBusyMinutes = computeTotalBusyMinutes(busyBlocks, windowStart, windowEnd);
    const windowMinutes = Math.floor((windowEnd.getTime() - windowStart.getTime()) / 60000);
    const totalFreeMinutes = Math.max(0, windowMinutes - totalBusyMinutes);

    let isFreeAt: boolean | null = null;
    if (checkTimeIso) {
      const checkTime = new Date(checkTimeIso).getTime();
      isFreeAt = !busyBlocks.some(
        (b) => checkTime >= new Date(b.start).getTime() && checkTime < new Date(b.end).getTime()
      );
    }

    this.lastSuccessfulReadAt = new Date().toISOString();
    this.lastError = null;

    return {
      calendarId,
      timeMin,
      timeMax,
      timezone: raw.timeZone ?? null,
      busyBlocks,
      freeSlots,
      isFreeAt,
      totalBusyMinutes,
      totalFreeMinutes
    };
  }

  toIngressRecord(event: CalendarEventDetail): CalendarReadIngressRecord {
    const content = [
      `Title: ${event.title}`,
      `When: ${event.startIso} – ${event.endIso}${event.allDay ? " (all-day)" : ""}`,
      event.location ? `Location: ${event.location}` : null,
      event.description ? `Description: ${event.description}` : null,
      event.hasAttendees ? `Attendees: ${event.attendeeCount}` : null
    ]
      .filter(Boolean)
      .join("\n");

    return {
      sourceId: `calendar:${event.calendarId}:${event.eventId}`,
      sourceType: "calendar_event",
      title: event.title,
      content,
      contentPreview: content.slice(0, 500),
      trustClassification: "EXTERNAL_UNTRUSTED",
      provenance: event.provenance,
      metadata: {
        calendarId: event.calendarId,
        eventId: event.eventId,
        startIso: event.startIso,
        endIso: event.endIso,
        allDay: event.allDay,
        hasAttendees: event.hasAttendees,
        attendeeCount: event.attendeeCount,
        location: event.location,
        hasMeetingLink: event.hasMeetingLink
      }
    };
  }

  private async withErrorCapture<T>(op: () => Promise<T>): Promise<T> {
    try {
      return await op();
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : "unknown";
      throw error;
    }
  }
}

// ── CalendarWriteConnector ────────────────────────────────────────────────────

export class CalendarWriteConnector {
  private static readonly BASE_URL = "https://www.googleapis.com/calendar/v3";

  constructor(private readonly apiClient: CalendarApiClient) {}

  async checkConflict(
    accessToken: string,
    calendarId: string,
    proposedStart: string,
    proposedEnd: string
  ): Promise<CalendarConflictCheckResult> {
    const url = `${CalendarWriteConnector.BASE_URL}/freeBusy`;
    const body: Record<string, unknown> = {
      timeMin: proposedStart,
      timeMax: proposedEnd,
      items: [{ id: calendarId }]
    };

    let busyBlocks: CalendarBusyBlock[] = [];
    try {
      const raw = await this.apiClient.post<GoogleFreeBusyResponse>(url, body, accessToken);
      busyBlocks = (raw.calendars?.[calendarId]?.busy ?? []).map((b) => ({
        start: b.start,
        end: b.end
      }));
    } catch {
      // Conflict check failure is non-fatal — return unknown state
      return {
        calendarId,
        proposedStart,
        proposedEnd,
        hasConflict: false,
        conflicts: [],
        freeSlots: [],
        conflictSeverity: "none",
        warning: "Conflict check could not be completed. Proceeding without conflict data."
      };
    }

    const windowStart = new Date(proposedStart);
    const windowEnd = new Date(proposedEnd);
    const freeSlots = computeFreeSlots(busyBlocks, windowStart, windowEnd, 0);
    const hasConflict = busyBlocks.length > 0;
    const conflictSeverity: CalendarConflictCheckResult["conflictSeverity"] = !hasConflict
      ? "none"
      : busyBlocks.some((b) => new Date(b.start) < windowEnd && new Date(b.end) > windowStart)
        ? "hard"
        : "soft";
    const warning = hasConflict
      ? `Proposed time ${proposedStart}–${proposedEnd} overlaps with ${busyBlocks.length} existing event(s).`
      : null;

    return {
      calendarId,
      proposedStart,
      proposedEnd,
      hasConflict,
      conflicts: busyBlocks,
      freeSlots,
      conflictSeverity,
      warning
    };
  }

  async createEvent(
    accessToken: string,
    account: IntegrationAccountRecord,
    input: CalendarCreateEventInput
  ): Promise<CalendarCreateEventResult> {
    const calendarId = input.calendarId ?? "primary";
    const hasAttendees = Boolean(input.attendees && input.attendees.length > 0);

    const conflictCheck = await this.checkConflict(
      accessToken,
      calendarId,
      input.startDateTime,
      input.endDateTime
    );

    const eventBody: Record<string, unknown> = {
      summary: input.summary,
      start: input.timeZone
        ? { dateTime: input.startDateTime, timeZone: input.timeZone }
        : { dateTime: input.startDateTime },
      end: input.timeZone
        ? { dateTime: input.endDateTime, timeZone: input.timeZone }
        : { dateTime: input.endDateTime }
    };
    if (input.description) eventBody.description = input.description;
    if (input.location) eventBody.location = input.location;
    if (input.attendees?.length) {
      eventBody.attendees = input.attendees.map((a) =>
        a.displayName ? { email: a.email, displayName: a.displayName } : { email: a.email }
      );
    }
    if (input.reminders) {
      eventBody.reminders = input.reminders.useDefault === true
        ? { useDefault: true }
        : { useDefault: false, overrides: input.reminders.overrides ?? [] };
    }
    if (input.visibility) eventBody.visibility = input.visibility;
    if (typeof input.guestsCanModify === "boolean") eventBody.guestsCanModify = input.guestsCanModify;
    if (typeof input.guestsCanInviteOthers === "boolean") eventBody.guestsCanInviteOthers = input.guestsCanInviteOthers;

    const sendUpdates = hasAttendees && input.sendNotifications !== false ? "all" : "none";
    const url = `${CalendarWriteConnector.BASE_URL}/calendars/${encodeURIComponent(calendarId)}/events?sendUpdates=${sendUpdates}`;

    const raw = await this.withErrorCapture<GoogleCalendarEvent>(() =>
      this.apiClient.post<GoogleCalendarEvent>(url, eventBody, accessToken)
    );

    const startIso = resolveIsoStart(raw.start);
    const endIso = resolveIsoEnd(raw.end);
    const attendeeCount = raw.attendees?.length ?? 0;
    const actionId: CalendarWriteActionId = hasAttendees
      ? "calendar.event.create_with_attendees"
      : "calendar.event.create";

    return {
      eventId: raw.id,
      calendarId,
      htmlLink: raw.htmlLink ?? null,
      status: raw.status ?? "confirmed",
      summary: raw.summary ?? input.summary,
      startIso,
      endIso,
      attendeeCount,
      hasAttendees: attendeeCount > 0,
      created: raw.created ?? null,
      actionId,
      connectorId: account.connectorId,
      accountId: account.accountId,
      conflictCheck
    };
  }

  async updateEvent(
    accessToken: string,
    account: IntegrationAccountRecord,
    input: CalendarUpdateEventInput
  ): Promise<CalendarUpdateEventResult> {
    const calendarId = input.calendarId ?? "primary";

    // Fetch current event to merge attendees and determine conflict window
    const getUrl = `${CalendarWriteConnector.BASE_URL}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(input.eventId)}`;
    let currentEvent: GoogleCalendarEvent | null = null;
    try {
      currentEvent = await this.apiClient.get<GoogleCalendarEvent>(getUrl, accessToken);
    } catch {
      // Non-fatal: proceed with patch even if we can't read current state
    }

    const patchBody: Record<string, unknown> = {};
    if (input.summary !== undefined) patchBody.summary = input.summary;
    if (input.description !== undefined) patchBody.description = input.description;
    if (input.location !== undefined) patchBody.location = input.location;
    if (input.visibility !== undefined) patchBody.visibility = input.visibility;

    let hasTimeChange = false;
    if (input.startDateTime !== undefined || input.endDateTime !== undefined) {
      hasTimeChange = true;
      const tz = input.timeZone;
      if (input.startDateTime !== undefined) {
        patchBody.start = tz ? { dateTime: input.startDateTime, timeZone: tz } : { dateTime: input.startDateTime };
      }
      if (input.endDateTime !== undefined) {
        patchBody.end = tz ? { dateTime: input.endDateTime, timeZone: tz } : { dateTime: input.endDateTime };
      }
    }

    // Merge attendees: start from existing list, add/remove as requested
    const existingAttendees: Array<{ email: string; displayName?: string }> =
      (currentEvent?.attendees ?? []).map((a) => ({
        email: a.email ?? "",
        ...(a.displayName ? { displayName: a.displayName } : {})
      }));
    const removeSet = new Set(input.attendeesToRemove ?? []);
    let mergedAttendees = existingAttendees.filter((a) => !removeSet.has(a.email));
    if (input.attendeesToAdd?.length) {
      const existingEmails = new Set(mergedAttendees.map((a) => a.email));
      for (const add of input.attendeesToAdd) {
        if (!existingEmails.has(add.email)) {
          mergedAttendees.push(add.displayName ? { email: add.email, displayName: add.displayName } : { email: add.email });
        }
      }
    }
    const attendeesChanged = Boolean(input.attendeesToAdd?.length || input.attendeesToRemove?.length);
    if (attendeesChanged) {
      patchBody.attendees = mergedAttendees;
    }
    if (input.reminders) {
      patchBody.reminders = input.reminders.useDefault === true
        ? { useDefault: true }
        : { useDefault: false, overrides: input.reminders.overrides ?? [] };
    }

    const hasAttendees = mergedAttendees.length > 0;
    const sendUpdates = hasAttendees && input.sendNotifications !== false ? "all" : "none";

    // Conflict check if time is changing
    let conflictCheck: CalendarConflictCheckResult | null = null;
    if (hasTimeChange && input.startDateTime && input.endDateTime) {
      conflictCheck = await this.checkConflict(
        accessToken,
        calendarId,
        input.startDateTime,
        input.endDateTime
      );
    }

    const patchUrl = `${CalendarWriteConnector.BASE_URL}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(input.eventId)}?sendUpdates=${sendUpdates}`;
    const raw = await this.withErrorCapture<GoogleCalendarEvent>(() =>
      this.apiClient.patch<GoogleCalendarEvent>(patchUrl, patchBody, accessToken)
    );

    const startIso = resolveIsoStart(raw.start);
    const endIso = resolveIsoEnd(raw.end);
    const attendeeCount = raw.attendees?.length ?? 0;
    const actionId: CalendarWriteActionId =
      (attendeesChanged && hasAttendees) || (hasAttendees && hasTimeChange)
        ? "calendar.event.update_attendees"
        : "calendar.event.update";

    return {
      eventId: raw.id,
      calendarId,
      htmlLink: raw.htmlLink ?? null,
      status: raw.status ?? "confirmed",
      summary: raw.summary ?? "",
      startIso,
      endIso,
      attendeeCount,
      hasAttendees: attendeeCount > 0,
      updated: raw.updated ?? null,
      actionId,
      connectorId: account.connectorId,
      accountId: account.accountId,
      conflictCheck
    };
  }

  async deleteEvent(
    accessToken: string,
    account: IntegrationAccountRecord,
    input: CalendarDeleteEventInput
  ): Promise<CalendarDeleteEventResult> {
    const calendarId = input.calendarId ?? "primary";
    const sendUpdates = input.sendNotifications !== false ? "all" : "none";
    const url = `${CalendarWriteConnector.BASE_URL}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(input.eventId)}?sendUpdates=${sendUpdates}`;

    await this.withErrorCapture(() => this.apiClient.delete_(url, accessToken));

    return {
      eventId: input.eventId,
      calendarId,
      deleted: true,
      deletedAt: new Date().toISOString(),
      actionId: "calendar.event.delete",
      connectorId: account.connectorId,
      accountId: account.accountId
    };
  }

  private withErrorCapture<T>(op: () => Promise<T>): Promise<T> {
    return op();
  }
}
