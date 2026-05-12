import { useMemo, useState } from "react";
import { useApi } from "../hooks/useApi.js";
import {
  checkGoogleActionPermission,
  disconnectGoogleIntegration,
  fetchGmailAttention,
  fetchGmailHealth,
  fetchGoogleAuthorizationSnapshot,
  fetchIntegrationAccounts,
  startGoogleConnectFlow
} from "../api/client.js";
import "./settings.css";

export function Integrations() {
  const { data, loading, refresh } = useApi(fetchIntegrationAccounts, []);
  const { data: authz, refresh: refreshAuthz } = useApi(fetchGoogleAuthorizationSnapshot, []);
  const { data: gmailHealth, refresh: refreshGmailHealth } = useApi(fetchGmailHealth, []);
  const [busy, setBusy] = useState(false);
  const [checkResult, setCheckResult] = useState<string>("");
  const [attentionResult, setAttentionResult] = useState<string>("");

  const google = useMemo(() => data?.find((item) => item.providerId === "google") ?? null, [data]);

  const onConnect = async () => {
    setBusy(true);
    const started = await startGoogleConnectFlow();
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

            <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
              <button className="btn" disabled={busy} onClick={onConnect}>Connect / Reconnect</button>
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
                    <td>{action.actionId}</td>
                    <td>{action.class}</td>
                    <td>{action.approvalSensitivity}</td>
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
