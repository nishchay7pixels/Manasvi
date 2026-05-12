# Google Calendar Read Integration

Manasvi can read your Google Calendar to answer scheduling questions, find availability, and summarize upcoming meetings. This page explains what Calendar read can do, how to enable it, and what it does not yet do.

---

## What Calendar Read Enables

With Calendar read access, Manasvi can:

- **Answer "What's on my calendar today?"** — returns all events for the current day
- **Summarize upcoming meetings** — "What are my next 5 meetings?"
- **Check availability** — "Am I free tomorrow from 2 to 4pm?"
- **Find open time slots** — lists free windows of 15+ minutes in a given time range
- **List your calendars** — shows all calendars accessible to the connected account
- **Inspect a specific event** — title, time, location, attendees, meeting link

---

## What Calendar Read Does Not Do

Calendar read is read-only. Manasvi **cannot**:

- Create, edit, or delete calendar events
- RSVP or update attendee status
- Book meetings or schedule time
- Change reminders or notifications
- Move events between calendars

These write actions are not implemented in this release.

---

## How to Connect

### Step 1 — Start the OAuth flow with the Calendar scope

```bash
pnpm manasvi integrations add google calendar
```

This requests `gmail.readonly` plus `calendar.readonly`.

To add Calendar read on top of existing Gmail write access:

```bash
pnpm manasvi integrations add google full
```

Or connect via the admin dashboard → Integrations → **Connect with Calendar read**.

### Step 2 — Authorize in your browser

Open the printed URL and approve the `View your calendar events` permission in your Google account.

### Step 3 — Verify connection

```bash
pnpm manasvi integrations calendar-health
```

You should see:

```
status              authorized_read
calendar read authorized  yes
```

---

## Verifying Calendar Access

```bash
# Today's events
pnpm manasvi integrations calendar-today

# Today's events in a specific timezone
pnpm manasvi integrations calendar-today "America/New_York"

# Next 10 upcoming events
pnpm manasvi integrations calendar-upcoming

# Next 5 upcoming events
pnpm manasvi integrations calendar-upcoming 5

# Permission check
pnpm manasvi integrations check calendar.events.read
```

---

## Available Tools

The following tools are exposed to the Manasvi runtime when Calendar read is enabled:

| Tool ID | Description |
|---------|-------------|
| `tool.calendar-list-calendars` | List all accessible Google Calendars |
| `tool.calendar-list-events` | List events in a time window |
| `tool.calendar-get-today-events` | Get today's events (timezone-aware) |
| `tool.calendar-get-upcoming-events` | Get next N upcoming events |
| `tool.calendar-check-availability` | Check free/busy status in a time window |

All tools are read-only and governed by the same policy framework as Gmail read.

---

## Timezone Behavior

- "Today's events" uses the timezone you supply, or UTC if none is given
- Pass an IANA timezone name (e.g. `America/New_York`, `Europe/London`, `Asia/Kolkata`)
- All event times are returned as ISO-8601 strings
- All-day events have `allDay: true` and are distinguished from timed events
- Event-specific timezone overrides (e.g. a recurring event in a different timezone) are preserved in the `timezone` field

---

## Privacy and Safety Notes

- Calendar content is classified as **EXTERNAL_UNTRUSTED** — Manasvi treats calendar titles, descriptions, and attendee names as external user-controlled text
- No calendar data is stored — all reads are live API calls at the time of the request
- Token access is encrypted at rest (AES-256-GCM)
- All Calendar read operations are logged in the audit trail with connector and account references
- Calendar read does not require or grant write permission to your calendar

---

## Troubleshooting

**`calendar read authorized: no`**

The connected Google account does not have the `calendar.readonly` scope. Reconnect:
```bash
pnpm manasvi integrations add google calendar
```

**`status: token_refresh_needed` or `refresh_failed`**

The access token has expired and could not be refreshed. Reconnect:
```bash
pnpm manasvi integrations remove google
pnpm manasvi integrations add google calendar
```

**`status: degraded`**

The account is connected but the calendar scope is missing. Same remediation as above.

**`CALENDAR_AUTHORIZATION_FAILED` in API response**

Google rejected the request — the token may have been revoked externally (e.g. via Google Account settings). Reconnect.

**`CALENDAR_UPSTREAM_ERROR`**

Google Calendar API returned an unexpected error (5xx). Check Google's service status. The error will retry automatically on the next request.

---

## Re-authorization Required?

If you connected Google before G5 was deployed, your token does not include the `calendar.readonly` scope. You will need to reconnect to add Calendar access. Existing Gmail read/write capabilities are preserved automatically via Google's `include_granted_scopes` mechanism.
