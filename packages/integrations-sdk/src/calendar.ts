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
    timezone?: string
  ): Promise<CalendarEventListResult> {
    const tz = timezone ?? "UTC";
    const now = new Date();
    const todayStart = new Date(now.toLocaleDateString("en-CA", { timeZone: tz }) + "T00:00:00");
    const todayEnd = new Date(now.toLocaleDateString("en-CA", { timeZone: tz }) + "T23:59:59");

    return this.listEvents(accessToken, account, {
      calendarId,
      timeMin: todayStart.toISOString(),
      timeMax: todayEnd.toISOString(),
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
    account: IntegrationAccountRecord,
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
