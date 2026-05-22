import {
  validateGoogleNativeCapabilityInput,
  type CalendarCreateInput,
  type CalendarDeleteInput,
  type CalendarListInput,
  type CalendarUpdateInput
} from "../../google-capability-inputs.js";
import type { NativeGoogleApiClient } from "./google-api-client-factory.js";
import { normalizeNativeCalendarEvents, type NativeCalendarEventRaw } from "./native-output-normalizers.js";

function eventBody(input: CalendarCreateInput | CalendarUpdateInput["patch"]) {
  const title = "title" in input ? input.title : undefined;
  const start = "start" in input ? input.start : undefined;
  const end = "end" in input ? input.end : undefined;
  const timezone = "timezone" in input ? input.timezone : undefined;
  return {
    ...(title ? { summary: title } : {}),
    ...(start ? { start: { dateTime: start, ...(timezone ? { timeZone: timezone } : {}) } } : {}),
    ...(end ? { end: { dateTime: end, ...(timezone ? { timeZone: timezone } : {}) } } : {}),
    ...("location" in input && input.location ? { location: input.location } : {}),
    ...("description" in input && input.description ? { description: input.description } : {}),
    ...("attendees" in input && input.attendees ? { attendees: input.attendees.map((email) => ({ email })) } : {})
  };
}

export class CalendarNativeClient {
  constructor(
    private readonly apiClient: NativeGoogleApiClient,
    private readonly baseUrl = "https://www.googleapis.com/calendar/v3"
  ) {}

  async list(accessToken: string, input: unknown) {
    const validated = validateGoogleNativeCapabilityInput("google.calendar.list", input) as CalendarListInput;
    const calendarId = validated.calendarId ?? "primary";
    const params = new URLSearchParams({
      singleEvents: "true",
      orderBy: "startTime",
      maxResults: String(validated.limit ?? 10)
    });
    if (validated.timeMin) params.set("timeMin", validated.timeMin);
    if (validated.timeMax) params.set("timeMax", validated.timeMax);
    const response = await this.apiClient.get<{ items?: NativeCalendarEventRaw[] }>(
      `${this.baseUrl}/calendars/${encodeURIComponent(calendarId)}/events?${params.toString()}`,
      accessToken
    );
    return normalizeNativeCalendarEvents(response.items ?? [], calendarId);
  }

  async create(accessToken: string, input: unknown) {
    const validated = validateGoogleNativeCapabilityInput("google.calendar.create", input) as CalendarCreateInput;
    const calendarId = validated.calendarId ?? "primary";
    const created = await this.apiClient.post<NativeCalendarEventRaw>(
      `${this.baseUrl}/calendars/${encodeURIComponent(calendarId)}/events`,
      eventBody(validated),
      accessToken
    );
    return normalizeNativeCalendarEvents([created], calendarId).events[0];
  }

  async update(accessToken: string, input: unknown) {
    const validated = validateGoogleNativeCapabilityInput("google.calendar.update", input) as CalendarUpdateInput;
    const calendarId = validated.calendarId ?? "primary";
    const updated = await this.apiClient.patch<NativeCalendarEventRaw>(
      `${this.baseUrl}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(validated.eventId)}`,
      eventBody(validated.patch),
      accessToken
    );
    return normalizeNativeCalendarEvents([updated], calendarId).events[0];
  }

  async delete(accessToken: string, input: unknown) {
    const validated = validateGoogleNativeCapabilityInput("google.calendar.delete", input) as CalendarDeleteInput;
    const calendarId = validated.calendarId ?? "primary";
    await this.apiClient.delete(
      `${this.baseUrl}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(validated.eventId)}`,
      accessToken
    );
    return {
      eventId: validated.eventId,
      calendarId,
      deleted: true,
      deletedAt: new Date().toISOString()
    };
  }
}
