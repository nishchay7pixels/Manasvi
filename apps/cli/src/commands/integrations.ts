import { banner, hint, info, section, success, table, warn } from "../lib/ui.js";
import { loadConfig, saveConfig } from "../lib/config.js";

interface IntegrationAccount {
  providerId: string;
  status: string;
  scopesGranted: string[];
  lastAuthAt: string | null;
  lastRefreshAt: string | null;
  lastError: string | null;
}

async function getGatewayPort(): Promise<number> {
  const cfg = await loadConfig();
  return cfg?.services.gatewayPort ?? 4100;
}

export async function runIntegrationsList(): Promise<void> {
  banner("integrations list");
  const port = await getGatewayPort();
  try {
    const res = await fetch(`http://127.0.0.1:${port}/integrations/accounts`);
    if (!res.ok) {
      warn("API gateway did not return integration accounts");
      return;
    }
    const body = (await res.json()) as { accounts: IntegrationAccount[] };
    section("Integration accounts");
    if (body.accounts.length === 0) {
      info("No connected integrations yet.");
      hint("Connect Google: pnpm manasvi integrations add google");
      return;
    }
    for (const account of body.accounts) {
      console.log(`- ${account.providerId}: ${account.status}`);
      console.log(`  scopes: ${account.scopesGranted.join(", ") || "-"}`);
      console.log(`  last auth: ${account.lastAuthAt ?? "-"}`);
      console.log(`  last refresh: ${account.lastRefreshAt ?? "-"}`);
      console.log(`  error: ${account.lastError ?? "-"}`);
    }
  } catch {
    warn("Failed to connect to API gateway. Start services first: pnpm manasvi start");
  }
}

export async function runIntegrationsStatus(): Promise<void> {
  banner("integrations status");
  const port = await getGatewayPort();
  try {
    const res = await fetch(`http://127.0.0.1:${port}/integrations/google/authorization`);
    if (!res.ok) {
      warn("Could not fetch Google integration status");
      return;
    }
    const body = (await res.json()) as {
      authorization: {
        connected: boolean;
        status: string;
        normalizedScopes: string[];
        availableCapabilities: Array<{ capabilityId: string; class: string; approvalSensitivity: string }>;
        actions: Array<{ actionId: string; canAttempt: boolean; approvalSensitivity: string; missingCapabilities: string[] }>;
      };
    };
    section("Google");
    if (!body.authorization.connected) {
      info("Status: not_connected");
      hint("Connect Google: pnpm manasvi integrations add google");
      return;
    }
    const auth = body.authorization;
    table([
      { label: "status", value: auth.status },
      { label: "normalized scopes", value: auth.normalizedScopes.join(", ") || "-" },
      { label: "capabilities", value: auth.availableCapabilities.map((item) => item.capabilityId).join(", ") || "-" }
    ]);
    console.log();
    section("Action authorization snapshot");
    for (const action of auth.actions) {
      console.log(
        `- ${action.actionId}: canAttempt=${action.canAttempt ? "yes" : "no"}, approval=${action.approvalSensitivity}, missing=${action.missingCapabilities.join(", ") || "-"}`
      );
    }
  } catch {
    warn("Failed to reach API gateway.");
  }
}

export async function runIntegrationsCheck(actionId?: string): Promise<void> {
  banner("integrations check");
  if (!actionId) {
    warn("Usage: pnpm manasvi integrations check <google-action-id>");
    return;
  }
  const port = await getGatewayPort();
  try {
    const res = await fetch(`http://127.0.0.1:${port}/integrations/google/permissions/check`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ actionId })
    });
    const body = (await res.json()) as {
      permission?: {
        decision: string;
        reasonCodes: string[];
        action: { actionId: string; serviceFamily: string; class: string; approvalSensitivity: string };
        requiredCapabilities: string[];
        availableCapabilities: string[];
        missingCapabilities: string[];
      };
      error?: string;
    };
    if (!res.ok || !body.permission) {
      warn(body.error ?? "Permission check failed");
      return;
    }
    const permission = body.permission;
    section(`Google action: ${permission.action.actionId}`);
    table([
      { label: "decision", value: permission.decision },
      { label: "service family", value: permission.action.serviceFamily },
      { label: "class", value: permission.action.class },
      { label: "approval sensitivity", value: permission.action.approvalSensitivity },
      { label: "required capabilities", value: permission.requiredCapabilities.join(", ") || "-" },
      { label: "available capabilities", value: permission.availableCapabilities.join(", ") || "-" },
      { label: "missing capabilities", value: permission.missingCapabilities.join(", ") || "-" },
      { label: "reason codes", value: permission.reasonCodes.join(", ") || "-" }
    ]);
  } catch {
    warn("Failed to reach API gateway.");
  }
}

export async function runIntegrationsGmailHealth(): Promise<void> {
  banner("integrations gmail health");
  const port = await getGatewayPort();
  const res = await fetch(`http://127.0.0.1:${port}/integrations/google/gmail/health`);
  if (!res.ok) {
    warn("Failed to fetch Gmail health");
    return;
  }
  const body = (await res.json()) as {
    health: {
      status: string;
      connected: boolean;
      gmailReadAuthorized: boolean;
      availableCapabilities: string[];
      missingCapabilities: string[];
      tokenPresent: boolean;
      lastSuccessfulReadAt: string | null;
      lastError: string | null;
    };
  };
  const h = body.health;
  table([
    { label: "status", value: h.status },
    { label: "connected", value: h.connected ? "yes" : "no" },
    { label: "gmail read authorized", value: h.gmailReadAuthorized ? "yes" : "no" },
    { label: "token present", value: h.tokenPresent ? "yes" : "no" },
    { label: "available capabilities", value: h.availableCapabilities.join(", ") || "-" },
    { label: "missing capabilities", value: h.missingCapabilities.join(", ") || "-" },
    { label: "last successful read", value: h.lastSuccessfulReadAt ?? "-" },
    { label: "last error", value: h.lastError ?? "-" }
  ]);
}

export async function runIntegrationsGmailAttention(): Promise<void> {
  banner("integrations gmail attention");
  const port = await getGatewayPort();
  const res = await fetch(`http://127.0.0.1:${port}/integrations/google/gmail/attention`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ maxResults: 10 })
  });
  if (!res.ok) {
    warn("Failed to fetch Gmail attention summary");
    return;
  }
  const body = (await res.json()) as {
    summary: { total: number; unreadCount: number; importantCount: number };
    items: Array<{ subject: string; from: string; unread: boolean; important: boolean; snippet: string }>;
  };
  table([
    { label: "total", value: String(body.summary.total) },
    { label: "unread", value: String(body.summary.unreadCount) },
    { label: "important", value: String(body.summary.importantCount) }
  ]);
  console.log();
  for (const item of body.items) {
    console.log(`- ${item.subject || "(no subject)"} | from=${item.from || "-"} | unread=${item.unread ? "yes" : "no"} | important=${item.important ? "yes" : "no"}`);
    console.log(`  ${item.snippet}`);
  }
}

export async function runIntegrationsCalendarHealth(): Promise<void> {
  banner("integrations calendar health");
  const port = await getGatewayPort();
  try {
    const res = await fetch(`http://127.0.0.1:${port}/integrations/google/calendar/health`);
    if (!res.ok) {
      warn("Failed to fetch Calendar health");
      return;
    }
    const body = (await res.json()) as {
      health: {
        status: string;
        connected: boolean;
        calendarReadAuthorized: boolean;
        availableCapabilities: string[];
        missingCapabilities: string[];
        tokenPresent: boolean;
        lastSuccessfulReadAt: string | null;
        lastError: string | null;
      };
    };
    const h = body.health;
    table([
      { label: "status", value: h.status },
      { label: "connected", value: h.connected ? "yes" : "no" },
      { label: "calendar read authorized", value: h.calendarReadAuthorized ? "yes" : "no" },
      { label: "token present", value: h.tokenPresent ? "yes" : "no" },
      { label: "available capabilities", value: h.availableCapabilities.join(", ") || "-" },
      { label: "missing capabilities", value: h.missingCapabilities.join(", ") || "-" },
      { label: "last successful read", value: h.lastSuccessfulReadAt ?? "-" },
      { label: "last error", value: h.lastError ?? "-" }
    ]);
    if (!h.calendarReadAuthorized) {
      hint("To enable Calendar read, reconnect Google with the calendar.readonly scope:");
      hint("  pnpm manasvi integrations add google calendar");
    }
  } catch {
    warn("Failed to reach API gateway. Start services first: pnpm manasvi start");
  }
}

export async function runIntegrationsCalendarToday(timezone?: string): Promise<void> {
  banner("integrations calendar today");
  const port = await getGatewayPort();
  try {
    const res = await fetch(`http://127.0.0.1:${port}/integrations/google/calendar/events/today`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...(timezone ? { timezone } : {}) })
    });
    if (!res.ok) {
      warn("Failed to fetch today's calendar events");
      return;
    }
    const body = (await res.json()) as {
      result: {
        events: Array<{
          title: string;
          startIso: string;
          endIso: string;
          allDay: boolean;
          location: string | null;
          hasAttendees: boolean;
          attendeeCount: number;
          hasMeetingLink: boolean;
        }>;
        timeZone: string | null;
        calendarId: string;
      };
    };
    const r = body.result;
    section(`Today's calendar (${r.calendarId}) — ${r.timeZone ?? "UTC"}`);
    if (r.events.length === 0) {
      info("No events scheduled today.");
      return;
    }
    for (const ev of r.events) {
      const time = ev.allDay
        ? "all-day"
        : `${new Date(ev.startIso).toLocaleTimeString()} – ${new Date(ev.endIso).toLocaleTimeString()}`;
      console.log(`- ${ev.title} | ${time}`);
      if (ev.location) console.log(`  location: ${ev.location}`);
      if (ev.hasAttendees) console.log(`  attendees: ${ev.attendeeCount}`);
      if (ev.hasMeetingLink) console.log(`  [meeting link available]`);
    }
  } catch {
    warn("Failed to reach API gateway.");
  }
}

export async function runIntegrationsCalendarUpcoming(maxResults?: string): Promise<void> {
  banner("integrations calendar upcoming");
  const port = await getGatewayPort();
  const n = Math.min(20, Math.max(1, parseInt(maxResults ?? "10", 10) || 10));
  try {
    const res = await fetch(`http://127.0.0.1:${port}/integrations/google/calendar/events/upcoming`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ maxResults: n })
    });
    if (!res.ok) {
      warn("Failed to fetch upcoming calendar events");
      return;
    }
    const body = (await res.json()) as {
      result: {
        events: Array<{
          title: string;
          startIso: string;
          endIso: string;
          allDay: boolean;
          location: string | null;
          hasAttendees: boolean;
          attendeeCount: number;
          hasMeetingLink: boolean;
          isRecurring: boolean;
        }>;
        totalCount: number;
        hasMore: boolean;
        timezone: string | null;
      };
    };
    const r = body.result;
    section(`Upcoming events (next ${n})`);
    if (r.events.length === 0) {
      info("No upcoming events found.");
      return;
    }
    for (const ev of r.events) {
      const start = ev.allDay ? ev.startIso.slice(0, 10) : new Date(ev.startIso).toLocaleString();
      console.log(`- ${ev.title}`);
      console.log(`  when: ${start}${ev.isRecurring ? " (recurring)" : ""}`);
      if (ev.location) console.log(`  location: ${ev.location}`);
      if (ev.hasAttendees) console.log(`  attendees: ${ev.attendeeCount}`);
      if (ev.hasMeetingLink) console.log(`  [meeting link]`);
    }
    if (r.hasMore) hint(`Showing ${r.totalCount} of more events. Use maxResults to fetch more.`);
  } catch {
    warn("Failed to reach API gateway.");
  }
}

export async function runIntegrationsAdd(provider?: string, mode?: string): Promise<void> {
  banner("integrations add");
  if (provider !== "google") {
    warn("Currently supported provider: google");
    return;
  }
  const port = await getGatewayPort();

  // mode: "read-only" | "write" (G4) | "calendar" (G5) | "calendar-write" (G6) | "full" (all)
  const isWrite = mode === "write" || mode === "full";
  const isCalendar = mode === "calendar" || mode === "full";
  const isCalendarWrite = mode === "calendar-write" || mode === "full";

  const baseScopes = ["openid", "email", "profile", "https://www.googleapis.com/auth/gmail.readonly"];
  const writeScopes = [
    "https://www.googleapis.com/auth/gmail.compose",
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/gmail.modify"
  ];
  const calendarReadScopes = ["https://www.googleapis.com/auth/calendar.readonly"];
  const calendarWriteScopes = ["https://www.googleapis.com/auth/calendar"];

  const scopes = [
    ...baseScopes,
    ...(isWrite ? writeScopes : []),
    // calendar write scope supersedes read-only scope
    ...(isCalendarWrite ? calendarWriteScopes : isCalendar ? calendarReadScopes : [])
  ];

  if (isWrite) {
    info("Requesting Gmail write scopes (compose, send, modify).");
    hint("This allows Manasvi to draft, send, archive, and label Gmail messages.");
    hint("Send actions always require explicit approval before execution.");
  }
  if (isCalendarWrite) {
    info("Requesting Calendar write scope (calendar — full access).");
    hint("This allows Manasvi to create, update, and delete calendar events.");
    hint("Attendee-facing actions and event deletions always require explicit approval before execution.");
  } else if (isCalendar) {
    info("Requesting Calendar read scope (calendar.readonly).");
    hint("This allows Manasvi to read calendar events, check availability, and summarize meetings.");
    hint("Calendar read is a safe read-only scope — no events will be created or modified.");
  }

  try {
    const res = await fetch(`http://127.0.0.1:${port}/integrations/google/connect/start`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scopes })
    });
    if (!res.ok) {
      warn("Failed to start Google OAuth flow");
      return;
    }
    const body = (await res.json()) as { authorizeUrl: string };
    info("Open this URL to connect Google:");
    console.log(body.authorizeUrl);
    hint("After approval, Google redirects to the configured callback URI and Manasvi finalizes the connection.");

    const cfg = await loadConfig();
    if (cfg) {
      cfg.integrations.google = { enabled: true, scopes };
      await saveConfig(cfg);
    }
  } catch {
    warn("Failed to reach API gateway. Start services first: pnpm manasvi start");
  }
}

export async function runIntegrationsGmailWriteStatus(): Promise<void> {
  banner("integrations gmail write status");
  const port = await getGatewayPort();
  try {
    const res = await fetch(`http://127.0.0.1:${port}/integrations/google/authorization`);
    if (!res.ok) {
      warn("Could not fetch Google integration authorization");
      return;
    }
    const body = (await res.json()) as {
      authorization: {
        connected: boolean;
        availableCapabilities: Array<{ capabilityId: string; class: string; approvalSensitivity: string }>;
        actions: Array<{ actionId: string; canAttempt: boolean; approvalSensitivity: string; missingCapabilities: string[] }>;
      };
    };
    if (!body.authorization.connected) {
      info("Google not connected.");
      hint("Connect with write scopes: pnpm manasvi integrations add google write");
      return;
    }
    const auth = body.authorization;
    const writeActions = auth.actions.filter((action) =>
      ["gmail.draft.create", "gmail.draft.reply", "gmail.message.send", "gmail.message.archive", "gmail.message.label"].includes(action.actionId)
    );
    section("Gmail Write Capability Status");
    for (const action of writeActions) {
      const status = action.canAttempt ? "AVAILABLE" : "MISSING SCOPE";
      const approval = action.approvalSensitivity === "required" ? " [APPROVAL REQUIRED]" : action.approvalSensitivity === "policy" ? " [APPROVAL MAY BE REQUIRED]" : "";
      console.log(`  ${action.actionId}: ${status}${approval}`);
      if (!action.canAttempt && action.missingCapabilities.length > 0) {
        console.log(`    missing: ${action.missingCapabilities.join(", ")}`);
      }
    }
    console.log();
    const hasCompose = auth.availableCapabilities.some((c) => c.capabilityId === "gmail.compose");
    const hasSend = auth.availableCapabilities.some((c) => c.capabilityId === "gmail.send");
    const hasModify = auth.availableCapabilities.some((c) => c.capabilityId === "gmail.modify");
    if (!hasCompose || !hasSend || !hasModify) {
      hint("To enable full Gmail write access, reconnect with write scopes:");
      hint("  pnpm manasvi integrations add google write");
    }
  } catch {
    warn("Failed to reach API gateway.");
  }
}

export async function runIntegrationsCalendarWriteStatus(): Promise<void> {
  banner("integrations calendar write status");
  const port = await getGatewayPort();
  try {
    const res = await fetch(`http://127.0.0.1:${port}/integrations/google/authorization`);
    if (!res.ok) {
      warn("Could not fetch Google integration authorization");
      return;
    }
    const body = (await res.json()) as {
      authorization: {
        connected: boolean;
        availableCapabilities: Array<{ capabilityId: string; class: string; approvalSensitivity: string }>;
        actions: Array<{ actionId: string; canAttempt: boolean; approvalSensitivity: string; missingCapabilities: string[] }>;
      };
    };
    if (!body.authorization.connected) {
      info("Google not connected.");
      hint("Connect with calendar write scope: pnpm manasvi integrations add google calendar-write");
      return;
    }
    const auth = body.authorization;
    const writeActionIds = [
      "calendar.event.create",
      "calendar.event.create_with_attendees",
      "calendar.event.update",
      "calendar.event.update_attendees",
      "calendar.event.delete"
    ];
    const writeActions = auth.actions.filter((action) => writeActionIds.includes(action.actionId));
    section("Calendar Write Capability Status");
    for (const action of writeActions) {
      const status = action.canAttempt ? "AVAILABLE" : "MISSING SCOPE";
      const approval = action.approvalSensitivity === "required" ? " [APPROVAL REQUIRED]" : action.approvalSensitivity === "policy" ? " [APPROVAL MAY BE REQUIRED]" : "";
      console.log(`  ${action.actionId}: ${status}${approval}`);
      if (!action.canAttempt && action.missingCapabilities.length > 0) {
        console.log(`    missing: ${action.missingCapabilities.join(", ")}`);
      }
    }
    console.log();
    const hasCreate = auth.availableCapabilities.some((c) => c.capabilityId === "calendar.create_event");
    const hasUpdate = auth.availableCapabilities.some((c) => c.capabilityId === "calendar.update_event");
    const hasInvite = auth.availableCapabilities.some((c) => c.capabilityId === "calendar.invite_attendees");
    const hasDelete = auth.availableCapabilities.some((c) => c.capabilityId === "calendar.delete_event");
    if (!hasCreate || !hasUpdate || !hasInvite || !hasDelete) {
      hint("To enable full Calendar write access, reconnect with the calendar write scope:");
      hint("  pnpm manasvi integrations add google calendar-write");
    }
  } catch {
    warn("Failed to reach API gateway.");
  }
}

export async function runIntegrationsRemove(provider?: string): Promise<void> {
  banner("integrations remove");
  if (provider !== "google") {
    warn("Currently supported provider in G1: google");
    return;
  }
  const port = await getGatewayPort();
  try {
    const res = await fetch(`http://127.0.0.1:${port}/integrations/google/disconnect`, { method: "POST" });
    if (!res.ok) {
      warn("Failed to disconnect Google integration");
      return;
    }
    success("Google integration disconnected");
  } catch {
    warn("Failed to reach API gateway.");
  }
}
