import { useApi } from "../hooks/useApi.js";
import { fetchPlugins } from "../api/client.js";
import {
  Badge, StatusBadge, TimeAgo, CopyId, EmptyState, LoadingState
} from "../components/ui/primitives.js";
import { Table, FilterBar, FilterSelect } from "../components/ui/Table.js";
import { useState } from "react";

export function Plugins() {
  const [stateFilter, setStateFilter] = useState("all");
  const { data, loading } = useApi(fetchPlugins);

  const rows = (data ?? []).filter((p) => stateFilter === "all" || p.state === stateFilter);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Plugins</h1>
          <p className="page-subtitle">Extension plugins — capability grants, risk class, isolation state</p>
        </div>
      </div>

      <div style={{
        fontSize: 12,
        padding: "10px 14px",
        background: "var(--bg-card)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius)",
        color: "var(--text-muted)",
      }}>
        ⊕ Plugin registry connects to the extension-runtime service. Plugins appear here when the runtime is running.
      </div>

      <FilterBar>
        <FilterSelect
          label="State"
          value={stateFilter}
          onChange={setStateFilter}
          options={[
            { value: "all", label: "All states" },
            { value: "enabled", label: "Enabled" },
            { value: "disabled", label: "Disabled" },
            { value: "quarantined", label: "Quarantined" },
            { value: "revoked", label: "Revoked" },
          ]}
        />
      </FilterBar>

      {loading && !data && <LoadingState label="Loading plugins…" />}

      {!loading && rows.length === 0 && (
        <EmptyState
          icon="⊕"
          title="No plugins installed"
          description="Plugins installed in the extension runtime appear here with their capability grants and risk classification."
        />
      )}

      {rows.length > 0 && (
        <Table
          columns={[
            {
              key: "id",
              header: "Plugin ID",
              render: (p) => <CopyId id={p.pluginId} maxLen={18} />,
            },
            { key: "name", header: "Name", render: (p) => <span style={{ color: "var(--text-primary)" }}>{p.name}</span> },
            { key: "version", header: "Version", width: "80px", render: (p) => <Badge variant="dim">{p.version ?? "—"}</Badge> },
            {
              key: "risk",
              header: "Risk",
              width: "90px",
              render: (p) => <StatusBadge status={p.riskClass} />,
            },
            {
              key: "state",
              header: "State",
              width: "110px",
              render: (p) => <StatusBadge status={p.state} />,
            },
            {
              key: "caps",
              header: "Capabilities",
              render: (p) => (
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                  {(p.grantedCapabilities ?? []).slice(0, 3).map((c) => (
                    <Badge key={c} variant="dim">{c}</Badge>
                  ))}
                  {(p.grantedCapabilities ?? []).length > 3 && (
                    <Badge variant="dim">+{(p.grantedCapabilities ?? []).length - 3}</Badge>
                  )}
                </div>
              ),
            },
            {
              key: "last",
              header: "Last Used",
              width: "100px",
              render: (p) => <TimeAgo iso={p.lastUsedAt} />,
            },
          ]}
          rows={rows}
          rowKey={(p) => p.pluginId}
        />
      )}
    </div>
  );
}
