import assert from "node:assert/strict";
import test from "node:test";

import {
  CalendarReadConnector,
  type CalendarApiClient
} from "./calendar.js";
import type { IntegrationAccountRecord } from "./index.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const connectedAccount: IntegrationAccountRecord = {
  accountId: "integration:google:acct-cal-1",
  providerId: "google",
  connectorId: "google-foundation",
  providerAccountId: "google-account:cal-test",
  status: "connected",
  scopesGranted: ["https://www.googleapis.com/auth/calendar.readonly"],
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

const disconnectedAccount: IntegrationAccountRecord = {
  ...connectedAccount,
  accountId: "integration:google:acct-cal-dis",
  status: "disconnected",
  scopesGranted: []
};

const noCalendarScopeAccount: IntegrationAccountRecord = {
  ...connectedAccount,
  accountId: "integration:google:acct-no-cal",
  scopesGranted: ["https://www.googleapis.com/auth/gmail.readonly"]
};

class MockCalendarClient implements CalendarApiClient {
  constructor(private readonly data: Record<string, unknown> = {}) {}
  async get<T>(url: string): Promise<T> {
    const key = Object.keys(this.data).find((k) => url.includes(k));
    if (!key) throw new Error(`no mock for GET ${url}`);
    return this.data[key] as T;
  }
  async post<T>(url: string, _body: Record<string, unknown>): Promise<T> {
    const key = Object.keys(this.data).find((k) => url.includes(k));
    if (!key) throw new Error(`no mock for POST ${url}`);
    return this.data[key] as T;
  }
}

// ── Health tests ──────────────────────────────────────────────────────────────

test("computeHealth: authorized_read when calendar.readonly granted", () => {
  const connector = new CalendarReadConnector(new MockCalendarClient());
  const health = connector.computeHealth(connectedAccount, true);
  assert.equal(health.status, "authorized_read");
  assert.equal(health.connected, true);
  assert.equal(health.calendarReadAuthorized, true);
  assert.ok(health.availableCapabilities.includes("calendar.read_events"));
  assert.equal(health.missingCapabilities.length, 0);
  assert.equal(health.tokenPresent, true);
  assert.equal(health.providerId, "google");
});

test("computeHealth: disconnected when no account", () => {
  const connector = new CalendarReadConnector(new MockCalendarClient());
  const health = connector.computeHealth(null, false);
  assert.equal(health.status, "disconnected");
  assert.equal(health.connected, false);
  assert.equal(health.calendarReadAuthorized, false);
  assert.deepEqual(health.missingCapabilities, ["calendar.read_events"]);
});

test("computeHealth: degraded when calendar scope missing", () => {
  const connector = new CalendarReadConnector(new MockCalendarClient());
  const health = connector.computeHealth(noCalendarScopeAccount, true);
  assert.equal(health.status, "degraded");
  assert.equal(health.calendarReadAuthorized, false);
  assert.ok(health.missingCapabilities.includes("calendar.read_events"));
});

test("computeHealth: refresh_failed propagated", () => {
  const refreshFailedAccount = { ...connectedAccount, status: "refresh_failed" as const };
  const connector = new CalendarReadConnector(new MockCalendarClient());
  const health = connector.computeHealth(refreshFailedAccount, false);
  assert.equal(health.status, "refresh_failed");
});

test("computeHealth: token_refresh_needed propagated", () => {
  const needsRefreshAccount = { ...connectedAccount, status: "token_refresh_needed" as const };
  const connector = new CalendarReadConnector(new MockCalendarClient());
  const health = connector.computeHealth(needsRefreshAccount, true);
  assert.equal(health.status, "token_refresh_needed");
});

// ── listCalendars tests ───────────────────────────────────────────────────────

test("listCalendars: normalizes primary calendar entry", async () => {
  const connector = new CalendarReadConnector(
    new MockCalendarClient({
      "/users/me/calendarList": {
        items: [
          {
            id: "primary",
            summary: "My Calendar",
            description: "Primary calendar",
            primary: true,
            accessRole: "owner",
            timeZone: "America/New_York",
            selected: true,
            hidden: false,
            backgroundColor: "#4285f4"
          }
        ],
        nextPageToken: undefined
      }
    })
  );
  const result = await connector.listCalendars("token", connectedAccount);
  assert.equal(result.calendars.length, 1);
  const cal = result.calendars[0]!;
  assert.equal(cal.calendarId, "primary");
  assert.equal(cal.displayName, "My Calendar");
  assert.equal(cal.isPrimary, true);
  assert.equal(cal.accessRole, "owner");
  assert.equal(cal.timezone, "America/New_York");
  assert.equal(cal.selected, true);
  assert.equal(cal.hidden, false);
  assert.equal(cal.connectorId, connectedAccount.connectorId);
  assert.equal(cal.accountId, connectedAccount.accountId);
  assert.equal(result.nextPageToken, null);
});

test("listCalendars: multiple calendars returned", async () => {
  const connector = new CalendarReadConnector(
    new MockCalendarClient({
      "/users/me/calendarList": {
        items: [
          { id: "cal1", summary: "Work", primary: true, accessRole: "owner" },
          { id: "cal2", summary: "Personal", primary: false, accessRole: "reader" }
        ]
      }
    })
  );
  const result = await connector.listCalendars("token", connectedAccount);
  assert.equal(result.calendars.length, 2);
  assert.equal(result.calendars[0]!.displayName, "Work");
  assert.equal(result.calendars[1]!.displayName, "Personal");
  assert.equal(result.calendars[1]!.isPrimary, false);
});

// ── listEvents tests ──────────────────────────────────────────────────────────

const sampleApiEvent = {
  id: "event1",
  summary: "Team Standup",
  description: "Daily standup meeting",
  location: "Zoom",
  start: { dateTime: "2026-05-12T09:00:00-07:00", timeZone: "America/Los_Angeles" },
  end: { dateTime: "2026-05-12T09:30:00-07:00", timeZone: "America/Los_Angeles" },
  status: "confirmed",
  attendees: [
    { email: "alice@example.com", displayName: "Alice", responseStatus: "accepted", self: false, organizer: false },
    { email: "me@example.com", displayName: "Me", responseStatus: "accepted", self: true, organizer: true }
  ],
  organizer: { email: "me@example.com", displayName: "Me" },
  hangoutLink: "https://meet.google.com/abc-def",
  htmlLink: "https://calendar.google.com/event?eid=event1",
  created: "2026-05-01T00:00:00Z",
  updated: "2026-05-10T00:00:00Z"
};

test("listEvents: normalizes timed event with attendees and meeting link", async () => {
  const connector = new CalendarReadConnector(
    new MockCalendarClient({
      "/calendars/primary/events": {
        items: [sampleApiEvent],
        timeZone: "America/Los_Angeles"
      }
    })
  );
  const result = await connector.listEvents("token", connectedAccount, { calendarId: "primary" });
  assert.equal(result.events.length, 1);
  const ev = result.events[0]!;
  assert.equal(ev.eventId, "event1");
  assert.equal(ev.calendarId, "primary");
  assert.equal(ev.title, "Team Standup");
  assert.equal(ev.location, "Zoom");
  assert.equal(ev.allDay, false);
  assert.equal(ev.startIso, "2026-05-12T09:00:00-07:00");
  assert.equal(ev.endIso, "2026-05-12T09:30:00-07:00");
  assert.equal(ev.timezone, "America/Los_Angeles");
  assert.equal(ev.attendeeCount, 2);
  assert.equal(ev.hasAttendees, true);
  assert.equal(ev.hasMeetingLink, true);
  assert.equal(ev.meetingLink, "https://meet.google.com/abc-def");
  assert.equal(ev.organizerEmail, "me@example.com");
  assert.equal(ev.isRecurring, false);
  assert.equal(ev.connectorId, connectedAccount.connectorId);
  assert.equal(ev.accountId, connectedAccount.accountId);
  assert.equal(result.timeZone, "America/Los_Angeles");
});

test("listEvents: handles all-day event correctly", async () => {
  const connector = new CalendarReadConnector(
    new MockCalendarClient({
      "/calendars/primary/events": {
        items: [
          {
            id: "allday1",
            summary: "Company Holiday",
            start: { date: "2026-05-25" },
            end: { date: "2026-05-26" },
            status: "confirmed"
          }
        ]
      }
    })
  );
  const result = await connector.listEvents("token", connectedAccount, { calendarId: "primary" });
  const ev = result.events[0]!;
  assert.equal(ev.allDay, true);
  assert.equal(ev.title, "Company Holiday");
  assert.equal(ev.startIso, "2026-05-25T00:00:00");
  assert.equal(ev.endIso, "2026-05-26T23:59:59");
  assert.equal(ev.attendeeCount, 0);
  assert.equal(ev.hasAttendees, false);
  assert.equal(ev.hasMeetingLink, false);
});

test("listEvents: event with no title uses fallback", async () => {
  const connector = new CalendarReadConnector(
    new MockCalendarClient({
      "/calendars/primary/events": {
        items: [{ id: "untitled1", start: { dateTime: "2026-05-12T10:00:00Z" }, end: { dateTime: "2026-05-12T11:00:00Z" } }]
      }
    })
  );
  const result = await connector.listEvents("token", connectedAccount, { calendarId: "primary" });
  assert.equal(result.events[0]!.title, "(no title)");
});

test("listEvents: recurring event has isRecurring=true", async () => {
  const connector = new CalendarReadConnector(
    new MockCalendarClient({
      "/calendars/primary/events": {
        items: [
          {
            id: "recur-instance",
            summary: "Weekly Sync",
            recurringEventId: "recur-base",
            start: { dateTime: "2026-05-12T14:00:00Z" },
            end: { dateTime: "2026-05-12T15:00:00Z" }
          }
        ]
      }
    })
  );
  const result = await connector.listEvents("token", connectedAccount, { calendarId: "primary" });
  const ev = result.events[0]!;
  assert.equal(ev.isRecurring, true);
  assert.equal(ev.recurringEventId, "recur-base");
});

// ── getEvent tests ────────────────────────────────────────────────────────────

test("getEvent: returns CalendarEventDetail with provenance", async () => {
  const connector = new CalendarReadConnector(
    new MockCalendarClient({
      "/calendars/primary/events/event1": sampleApiEvent
    })
  );
  const event = await connector.getEvent("token", connectedAccount, "primary", "event1");
  assert.equal(event.eventId, "event1");
  assert.equal(event.attendees.length, 2);
  assert.equal(event.attendees[0]!.email, "alice@example.com");
  assert.equal(event.attendees[0]!.responseStatus, "accepted");
  assert.equal(event.attendees[1]!.self, true);
  assert.equal(event.htmlLink, "https://calendar.google.com/event?eid=event1");
  assert.equal(event.provenance.source, "google_calendar");
  assert.equal(event.provenance.trustClassification, "EXTERNAL_UNTRUSTED");
  assert.equal(event.provenance.provider, "google");
  assert.equal(event.provenance.calendarId, "primary");
  assert.equal(event.provenance.eventId, "event1");
  assert.equal(event.provenance.connectorId, connectedAccount.connectorId);
  assert.ok(event.provenance.fetchedAt);
});

// ── getUpcomingEvents tests ───────────────────────────────────────────────────

test("getUpcomingEvents: returns bounded upcoming events", async () => {
  const events = Array.from({ length: 6 }, (_, i) => ({
    id: `ev${i}`,
    summary: `Event ${i}`,
    start: { dateTime: new Date(Date.now() + i * 3600000).toISOString() },
    end: { dateTime: new Date(Date.now() + i * 3600000 + 1800000).toISOString() }
  }));
  const connector = new CalendarReadConnector(
    new MockCalendarClient({
      "/calendars/primary/events": { items: events }
    })
  );
  const result = await connector.getUpcomingEvents("token", connectedAccount, "primary", 5);
  assert.equal(result.events.length, 5);
  assert.equal(result.totalCount, 5);
  assert.equal(result.hasMore, true);
  assert.equal(result.calendarId, "primary");
  assert.ok(result.fetchedAt);
});

test("getUpcomingEvents: hasMore=false when fewer events than requested", async () => {
  const connector = new CalendarReadConnector(
    new MockCalendarClient({
      "/calendars/primary/events": {
        items: [
          { id: "e1", summary: "One event", start: { dateTime: new Date(Date.now() + 3600000).toISOString() }, end: { dateTime: new Date(Date.now() + 7200000).toISOString() } }
        ]
      }
    })
  );
  const result = await connector.getUpcomingEvents("token", connectedAccount, "primary", 5);
  assert.equal(result.events.length, 1);
  assert.equal(result.hasMore, false);
});

// ── checkAvailability tests ───────────────────────────────────────────────────

test("checkAvailability: returns busy blocks and free slots", async () => {
  const timeMin = "2026-05-12T09:00:00Z";
  const timeMax = "2026-05-12T17:00:00Z";
  const connector = new CalendarReadConnector(
    new MockCalendarClient({
      "/freeBusy": {
        calendars: {
          primary: {
            busy: [
              { start: "2026-05-12T10:00:00Z", end: "2026-05-12T11:00:00Z" },
              { start: "2026-05-12T14:00:00Z", end: "2026-05-12T15:30:00Z" }
            ]
          }
        }
      }
    })
  );
  const result = await connector.checkAvailability("token", connectedAccount, "primary", timeMin, timeMax);
  assert.equal(result.calendarId, "primary");
  assert.equal(result.busyBlocks.length, 2);
  assert.equal(result.totalBusyMinutes, 150);
  assert.ok(result.freeSlots.length >= 2);
  const firstSlot = result.freeSlots[0]!;
  assert.equal(firstSlot.start, timeMin);
  assert.equal(firstSlot.end, "2026-05-12T10:00:00Z");
  assert.equal(firstSlot.durationMinutes, 60);
  assert.equal(result.isFreeAt, null);
});

test("checkAvailability: isFreeAt=true when checkTimeIso is in free period", async () => {
  const connector = new CalendarReadConnector(
    new MockCalendarClient({
      "/freeBusy": {
        calendars: {
          primary: {
            busy: [{ start: "2026-05-12T10:00:00Z", end: "2026-05-12T11:00:00Z" }]
          }
        }
      }
    })
  );
  const result = await connector.checkAvailability(
    "token", connectedAccount, "primary",
    "2026-05-12T09:00:00Z", "2026-05-12T17:00:00Z",
    "2026-05-12T13:00:00Z"
  );
  assert.equal(result.isFreeAt, true);
});

test("checkAvailability: isFreeAt=false when checkTimeIso overlaps a busy block", async () => {
  const connector = new CalendarReadConnector(
    new MockCalendarClient({
      "/freeBusy": {
        calendars: {
          primary: {
            busy: [{ start: "2026-05-12T10:00:00Z", end: "2026-05-12T11:00:00Z" }]
          }
        }
      }
    })
  );
  const result = await connector.checkAvailability(
    "token", connectedAccount, "primary",
    "2026-05-12T09:00:00Z", "2026-05-12T17:00:00Z",
    "2026-05-12T10:30:00Z"
  );
  assert.equal(result.isFreeAt, false);
});

test("checkAvailability: fully free calendar returns no busy blocks", async () => {
  const connector = new CalendarReadConnector(
    new MockCalendarClient({
      "/freeBusy": {
        calendars: { primary: { busy: [] } }
      }
    })
  );
  const result = await connector.checkAvailability(
    "token", connectedAccount, "primary",
    "2026-05-12T09:00:00Z", "2026-05-12T17:00:00Z"
  );
  assert.equal(result.busyBlocks.length, 0);
  assert.equal(result.totalBusyMinutes, 0);
  assert.equal(result.totalFreeMinutes, 480);
  assert.equal(result.freeSlots.length, 1);
  assert.equal(result.freeSlots[0]!.durationMinutes, 480);
});

// ── toIngressRecord tests ─────────────────────────────────────────────────────

test("toIngressRecord: produces EXTERNAL_UNTRUSTED provenance-linked record", async () => {
  const connector = new CalendarReadConnector(
    new MockCalendarClient({
      "/calendars/primary/events/event1": sampleApiEvent
    })
  );
  const event = await connector.getEvent("token", connectedAccount, "primary", "event1");
  const record = connector.toIngressRecord(event);
  assert.equal(record.sourceId, "calendar:primary:event1");
  assert.equal(record.sourceType, "calendar_event");
  assert.equal(record.title, "Team Standup");
  assert.equal(record.trustClassification, "EXTERNAL_UNTRUSTED");
  assert.equal(record.provenance.source, "google_calendar");
  assert.equal(record.provenance.trustClassification, "EXTERNAL_UNTRUSTED");
  assert.equal(record.metadata.calendarId, "primary");
  assert.equal(record.metadata.eventId, "event1");
  assert.equal(record.metadata.hasMeetingLink, true);
  assert.ok(record.content.includes("Team Standup"));
  assert.ok(record.content.includes("Zoom"));
});

// ── Error handling tests ──────────────────────────────────────────────────────

test("connector tracks lastError on API failure", async () => {
  const failClient: CalendarApiClient = {
    async get() { throw new Error("Calendar API read failed (401)"); },
    async post() { throw new Error("Calendar API request failed (401)"); }
  };
  const connector = new CalendarReadConnector(failClient);
  await assert.rejects(() => connector.listEvents("token", connectedAccount, {}));
  const health = connector.computeHealth(connectedAccount, true);
  assert.ok(health.lastError?.includes("401"));
});

// ── Metadata normalization tests ──────────────────────────────────────────────

test("description is capped at 500 characters", async () => {
  const longDesc = "x".repeat(600);
  const connector = new CalendarReadConnector(
    new MockCalendarClient({
      "/calendars/primary/events": {
        items: [{
          id: "ev-long",
          summary: "Long Description Event",
          description: longDesc,
          start: { dateTime: "2026-05-12T09:00:00Z" },
          end: { dateTime: "2026-05-12T10:00:00Z" }
        }]
      }
    })
  );
  const result = await connector.listEvents("token", connectedAccount, { calendarId: "primary" });
  assert.ok(result.events[0]!.description!.length <= 500);
});

test("conference data meeting link extracted from entry points", async () => {
  const connector = new CalendarReadConnector(
    new MockCalendarClient({
      "/calendars/primary/events": {
        items: [{
          id: "ev-meet",
          summary: "Video Call",
          start: { dateTime: "2026-05-12T09:00:00Z" },
          end: { dateTime: "2026-05-12T10:00:00Z" },
          conferenceData: {
            entryPoints: [
              { entryPointType: "phone", uri: "tel:+15551234567" },
              { entryPointType: "video", uri: "https://meet.google.com/xyz-abc" }
            ]
          }
        }]
      }
    })
  );
  const result = await connector.listEvents("token", connectedAccount, { calendarId: "primary" });
  const ev = result.events[0]!;
  assert.equal(ev.hasMeetingLink, true);
  assert.equal(ev.meetingLink, "https://meet.google.com/xyz-abc");
});
