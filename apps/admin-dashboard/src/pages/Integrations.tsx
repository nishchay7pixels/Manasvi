import { useMemo, useState } from "react";
import { useApi } from "../hooks/useApi.js";
import {
  checkGoogleActionPermission,
  disconnectGoogleIntegration,
  fetchCalendarHealth,
  fetchCalendarUpcoming,
  fetchGmailAttention,
  fetchGmailHealth,
  fetchGoogleAuthorizationSnapshot,
  fetchIntegrationAccounts,
  startGoogleConnectFlow
} from "../api/client.js";
import "./settings.css";

const WRITE_CAPABILITY_LABELS: Record<string, string> = {
  "gmail.compose": "Compose / Draft",
  "gmail.send": "Send messages",
  "gmail.modify": "Modify mailbox (archive, label)",
};

export function Integrations() {
  const { data, loading, refresh } = useApi(fetchIntegrationAccounts, []);
  const { data: authz, refresh: refreshAuthz } = useApi(fetchGoogleAuthorizationSnapshot, []);
  const { data: gmailHealth, refresh: refreshGmailHealth } = useApi(fetchGmailHealth, []);
  const { data: calendarHealth, refresh: refreshCalendarHealth } = useApi(fetchCalendarHealth, []);
  const { data: calendarUpcoming, refresh: refreshCalendarUpcoming } = useApi(fetchCalendarUpcoming, []);
  const [busy, setBusy] = useState(false);
  const [checkResult, setCheckResult] = useState<string>("");
  const [attentionResult, setAttentionResult] = useState<string>("");

  const google = useMemo(() => data?.find((item) => item.providerId === "google") ?? null, [data]);

  const availableCapabilityIds = useMemo(
    () => new Set(authz?.availableCapabilities.map((c) => c.capabilityId) ?? []),
    [authz]
  );

  const writeCapabilities = useMemo(() =>
    Object.entries(WRITE_CAPABILITY_LABELS).map(([id, label]) => ({
      id,
      label,
      available: availableCapabilityIds.has(id),
    })),
    [availableCapabilityIds]
  );

  const hasAllWriteCapabilities = writeCapabilities.every((c) => c.available);

  const onConnect = async (mode?: "read" | "write" | "calendar" | "full") => {
    setBusy(true);
    const started = await startGoogleConnectFlow(mode);
    setBusy(false);
    if (started?.authorizeUrl) {
      window.open(started.authorizeUrl, "_blank", "noopener,noreferrer");
    }
  };

  const onDisconnect = async () => {
    setBusy(true);
    await disconnectGoogleIntegration();
    await refresh();
    await refreshAuthz();
    setBusy(false);
  };

  const runCheck = async (actionId: string) => {
    const result = await checkGoogleActionPermission(actionId);
    if (!result) {
      setCheckResult(`${actionId}: check failed`);
      return;
    }
    setCheckResult(`${actionId}: ${result.decision} (${result.reasonCodes.join(", ") || "no-reason"})`);
  };

  const runAttention = async () => {
    const result = await fetchGmailAttention();
    if (!result) {
      setAttentionResult("Attention query failed");
      return;
    }
    setAttentionResult(`Unread: ${result.summary.unreadCount}, Important: ${result.summary.importantCount}, Total: ${result.summary.total}`);
  };

  return (
    <section className="page">
      <div className="page__header">
        <h2>Integrations</h2>
        <p>Manage provider connection, capabilities, and policy-bound authorization state.</p>
      </div>

      <div className="card">
        <div className="row between center">
          <div>
            <h3>Google</h3>
            <p className="muted">Foundation for Gmail, Calendar, Drive, and Docs connectors.</p>
          </div>
          <div>
            <strong>{google?.status ?? "not_connected"}</strong>
          </div>
        </div>

        {loading ? (
          <p className="muted">Loading integration status...</p>
        ) : (
          <>
            <div className="kv-grid" style={{ marginTop: 12 }}>
              <div className="kv"><span>Scopes</span><span>{google?.scopesGranted?.join(", ") ?? "-"}</span></div>
              <div className="kv"><span>Last auth</span><span>{google?.lastAuthAt ?? "-"}</span></div>
              <div className="kv"><span>Last refresh</span><span>{google?.lastRefreshAt ?? "-"}</span></div>
              <div className="kv"><span>Last error</span><span>{google?.lastError ?? "-"}</span></div>
            </div>

            <div style={{ display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
              <button className="btn" disabled={busy} onClick={() => onConnect("read")}>Connect (Gmail read)</button>
              <button className="btn" disabled={busy} onClick={() => onConnect("calendar")}>Connect with Calendar read</button>
              <button className="btn" disabled={busy} onClick={() => onConnect("write")}>Connect with Gmail write</button>
              <button className="btn" disabled={busy} onClick={() => onConnect("full")}>Connect (full scopes)</button>
              <button className="btn btn-danger" disabled={busy || !google} onClick={onDisconnect}>Disconnect</button>
              <button className="btn btn-ghost" disabled={busy} onClick={async () => { await refresh(); await refreshAuthz(); }}>Refresh</button>
            </div>
          </>
        )}
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h3>Gmail Read Health</h3>
        {!gmailHealth ? (
          <p className="muted">No Gmail health data available.</p>
        ) : (
          <div className="kv-grid" style={{ marginTop: 12 }}>
            <div className="kv"><span>Status</span><span>{gmailHealth.status}</span></div>
            <div className="kv"><span>Read authorized</span><span>{gmailHealth.gmailReadAuthorized ? "yes" : "no"}</span></div>
            <div className="kv"><span>Available capabilities</span><span>{gmailHealth.availableCapabilities.join(", ") || "-"}</span></div>
            <div className="kv"><span>Missing capabilities</span><span>{gmailHealth.missingCapabilities.join(", ") || "-"}</span></div>
            <div className="kv"><span>Last successful read</span><span>{gmailHealth.lastSuccessfulReadAt ?? "-"}</span></div>
            <div className="kv"><span>Last error</span><span>{gmailHealth.lastError ?? "-"}</span></div>
          </div>
        )}
        <div style={{ marginTop: 12 }}>
          <button className="btn btn-ghost" onClick={refreshGmailHealth}>Refresh Gmail health</button>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h3>Gmail Write Capabilities</h3>
        {!authz ? (
          <p className="muted">No authorization data available. Connect Google first.</p>
        ) : (
          <>
            <table className="table" style={{ marginTop: 12 }}>
              <thead>
                <tr>
                  <th>Capability</th>
                  <th>Function</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {writeCapabilities.map((cap) => (
                  <tr key={cap.id}>
                    <td><code>{cap.id}</code></td>
                    <td>{cap.label}</td>
                    <td>
                      {cap.available
                        ? <span style={{ color: "var(--color-success, #22c55e)", fontWeight: 600 }}>AVAILABLE</span>
                        : <span style={{ color: "var(--color-danger, #ef4444)", fontWeight: 600 }}>MISSING SCOPE</span>
                      }
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!hasAllWriteCapabilities && (
              <div style={{ marginTop: 12 }}>
                <p className="muted">Some write capabilities are missing. Reconnect with write scopes to enable drafting, sending, archiving, and labelling.</p>
                <button className="btn" style={{ marginTop: 8 }} disabled={busy} onClick={() => onConnect("write")}>
                  Upgrade to write scopes
                </button>
              </div>
            )}
          </>
        )}
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h3>Calendar Read Health</h3>
        {!calendarHealth ? (
          <p className="muted">No Calendar health data available. Connect Google with calendar.readonly scope first.</p>
        ) : (
          <div className="kv-grid" style={{ marginTop: 12 }}>
            <div className="kv"><span>Status</span><span>{calendarHealth.status}</span></div>
            <div className="kv"><span>Read authorized</span><span>{calendarHealth.calendarReadAuthorized ? "yes" : "no"}</span></div>
            <div className="kv"><span>Available capabilities</span><span>{calendarHealth.availableCapabilities.join(", ") || "-"}</span></div>
            <div className="kv"><span>Missing capabilities</span><span>{calendarHealth.missingCapabilities.join(", ") || "-"}</span></div>
            <div className="kv"><span>Last successful read</span><span>{calendarHealth.lastSuccessfulReadAt ?? "-"}</span></div>
            <div className="kv"><span>Last error</span><span>{calendarHealth.lastError ?? "-"}</span></div>
          </div>
        )}
        {calendarHealth && !calendarHealth.calendarReadAuthorized && (
          <p className="muted" style={{ marginTop: 8 }}>
            Calendar read scope missing. Reconnect Google with "Connect with Calendar read" to enable.
          </p>
        )}
        <div style={{ marginTop: 12 }}>
          <button className="btn btn-ghost" onClick={refreshCalendarHealth}>Refresh Calendar health</button>
        </div>
      </div>

      {calendarHealth?.calendarReadAuthorized && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="row between center">
            <h3>Upcoming Events</h3>
            <button className="btn btn-ghost" onClick={refreshCalendarUpcoming}>Refresh</button>
          </div>
          {!calendarUpcoming ? (
            <p className="muted" style={{ marginTop: 8 }}>No upcoming event data. Click refresh to fetch.</p>
          ) : calendarUpcoming.events.length === 0 ? (
            <p className="muted" style={{ marginTop: 8 }}>No upcoming events found.</p>
          ) : (
            <table className="table" style={{ marginTop: 12 }}>
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Start</th>
                  <th>Attendees</th>
                  <th>Meeting Link</th>
                  <th>Recurring</th>
                </tr>
              </thead>
              <tbody>
                {calendarUpcoming.events.map((ev) => (
                  <tr key={ev.eventId}>
                    <td>{ev.title}</td>
                    <td>{ev.allDay ? ev.startIso.slice(0, 10) + " (all-day)" : new Date(ev.startIso).toLocaleString()}</td>
                    <td>{ev.hasAttendees ? ev.attendeeCount : "-"}</td>
                    <td>{ev.hasMeetingLink ? "yes" : "-"}</td>
                    <td>{ev.isRecurring ? "yes" : "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {calendarUpcoming?.hasMore && (
            <p className="muted" style={{ marginTop: 8 }}>Showing first {calendarUpcoming.totalCount} events. More available.</p>
          )}
        </div>
      )}

      <div className="card" style={{ marginTop: 16 }}>
        <h3>Authorization Snapshot</h3>
        {!authz ? (
          <p className="muted">No authorization snapshot available.</p>
        ) : (
          <>
            <div className="kv-grid" style={{ marginTop: 12 }}>
              <div className="kv"><span>Connected</span><span>{authz.connected ? "yes" : "no"}</span></div>
              <div className="kv"><span>Status</span><span>{authz.status}</span></div>
              <div className="kv"><span>Normalized scopes</span><span>{authz.normalizedScopes.join(", ") || "-"}</span></div>
              <div className="kv"><span>Capabilities</span><span>{authz.availableCapabilities.map((c) => c.capabilityId).join(", ") || "-"}</span></div>
            </div>
            <table className="table" style={{ marginTop: 16 }}>
              <thead>
                <tr>
                  <th>Action</th>
                  <th>Class</th>
                  <th>Approval</th>
                  <th>Can Attempt</th>
                  <th>Missing Capabilities</th>
                  <th>Check</th>
                </tr>
              </thead>
              <tbody>
                {authz.actions.map((action) => (
                  <tr key={action.actionId}>
                    <td>
                      {action.actionId}
                      {action.approvalSensitivity === "required" && (
                        <span style={{
                          marginLeft: 8,
                          fontSize: "0.7rem",
                          fontWeight: 700,
                          color: "var(--color-danger, #ef4444)",
                          textTransform: "uppercase",
                          letterSpacing: "0.05em",
                        }}>
                          [approval required]
                        </span>
                      )}
                    </td>
                    <td>{action.class}</td>
                    <td>
                      <span style={{
                        fontWeight: action.approvalSensitivity === "required" ? 700 : undefined,
                        color: action.approvalSensitivity === "required"
                          ? "var(--color-danger, #ef4444)"
                          : action.approvalSensitivity === "policy"
                          ? "var(--color-warning, #f59e0b)"
                          : undefined,
                      }}>
                        {action.approvalSensitivity}
                      </span>
                    </td>
                    <td>{action.canAttempt ? "yes" : "no"}</td>
                    <td>{action.missingCapabilities.join(", ") || "-"}</td>
                    <td><button className="btn btn-ghost" onClick={() => runCheck(action.actionId)}>Run check</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {checkResult ? <p className="muted" style={{ marginTop: 8 }}>{checkResult}</p> : null}
            <div style={{ marginTop: 12 }}>
              <button className="btn btn-ghost" onClick={runAttention}>What needs my attention?</button>
              {attentionResult ? <p className="muted" style={{ marginTop: 8 }}>{attentionResult}</p> : null}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
