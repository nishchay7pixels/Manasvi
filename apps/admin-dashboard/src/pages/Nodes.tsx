import { useState } from "react";
import { usePolling } from "../hooks/useApi.js";
import { fetchNodes, quarantineNode, revokeNode } from "../api/client.js";
import {
  Badge, StatusBadge, TimeAgo, CopyId,
  EmptyState, LoadingState, Button
} from "../components/ui/primitives.js";
import { Table, FilterBar, FilterSelect } from "../components/ui/Table.js";
import type { NodeRecord } from "../api/types.js";

export function Nodes() {
  const [stateFilter, setStateFilter] = useState("all");
  const [selected, setSelected] = useState<NodeRecord | null>(null);
  const { data, loading, refresh } = usePolling(fetchNodes, 15_000);

  const rows = (data ?? []).filter((n) => stateFilter === "all" || n.state === stateFilter);

  const handleQuarantine = async (nodeId: string) => {
    await quarantineNode(nodeId);
    refresh();
    setSelected(null);
  };

  const handleRevoke = async (nodeId: string) => {
    await revokeNode(nodeId);
    refresh();
    setSelected(null);
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Nodes</h1>
          <p className="page-subtitle">Remote execution nodes — trust class, capabilities, dispatch history</p>
        </div>
        <Badge variant="default">{(data ?? []).length} total</Badge>
      </div>

      <FilterBar>
        <FilterSelect
          label="State"
          value={stateFilter}
          onChange={setStateFilter}
          options={[
            { value: "all", label: "All states" },
            { value: "active", label: "Active" },
            { value: "pairing", label: "Pairing" },
            { value: "quarantined", label: "Quarantined" },
            { value: "revoked", label: "Revoked" },
            { value: "offline", label: "Offline" },
          ]}
        />
      </FilterBar>

      {loading && !data && <LoadingState label="Loading nodes…" />}

      {!loading && rows.length === 0 && (
        <EmptyState
          icon="⊛"
          title="No nodes registered"
          description="Remote nodes appear here when paired with the node manager. Local execution uses the built-in runtime."
        />
      )}

      {rows.length > 0 && (
        <Table
          columns={[
            {
              key: "id",
              header: "Node ID",
              render: (n) => <CopyId id={n.nodeId} maxLen={16} />,
            },
            {
              key: "class",
              header: "Class",
              width: "140px",
              render: (n) => n.nodeClass
                ? <Badge variant="dim">{n.nodeClass}</Badge>
                : <span style={{ color: "var(--text-muted)" }}>—</span>,
            },
            {
              key: "trust",
              header: "Trust",
              width: "110px",
              render: (n) => <StatusBadge status={n.trustClass} label={n.trustClass.replace("_", " ")} />,
            },
            {
              key: "state",
              header: "State",
              width: "110px",
              render: (n) => <StatusBadge status={n.state} />,
            },
            {
              key: "dispatches",
              header: "Dispatches",
              width: "90px",
              render: (n) => (
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>
                  {n.dispatchCount ?? "—"}
                </span>
              ),
            },
            {
              key: "heartbeat",
              header: "Last Heartbeat",
              width: "120px",
              render: (n) => <TimeAgo iso={n.lastHeartbeatAt} />,
            },
            {
              key: "actions",
              header: "",
              width: "140px",
              render: (n) => n.state === "active" ? (
                <div style={{ display: "flex", gap: 6 }}>
                  <Button variant="ghost" size="sm" onClick={() => void handleQuarantine(n.nodeId)}>
                    Quarantine
                  </Button>
                </div>
              ) : null,
            },
          ]}
          rows={rows}
          rowKey={(n) => n.nodeId}
          onRowClick={setSelected}
        />
      )}

      {/* Detail drawer */}
      {selected && (
        <div className="drawer-overlay" onClick={() => setSelected(null)}>
          <div className="drawer" onClick={(e) => e.stopPropagation()}>
            <div className="drawer__header">
              <div>
                <div className="drawer__title">Node Detail</div>
                <CopyId id={selected.nodeId} maxLen={24} />
              </div>
              <button className="drawer__close" onClick={() => setSelected(null)}>✕</button>
            </div>
            <div className="drawer__body">
              <div className="drawer__section">
                <div className="drawer__section-title">Identity</div>
                <div className="drawer__detail-grid">
                  <span>State</span><StatusBadge status={selected.state} />
                  <span>Trust class</span><StatusBadge status={selected.trustClass} label={selected.trustClass.replace("_", " ")} />
                  <span>Node class</span><span>{selected.nodeClass ?? "—"}</span>
                  <span>Dispatches</span><span>{selected.dispatchCount ?? "—"}</span>
                  <span>Failures</span><span style={{ color: (selected.failureCount ?? 0) > 0 ? "var(--error)" : "var(--text-muted)" }}>{selected.failureCount ?? 0}</span>
                  <span>Last heartbeat</span><TimeAgo iso={selected.lastHeartbeatAt} />
                </div>
              </div>
              {selected.capabilities && selected.capabilities.length > 0 && (
                <div className="drawer__section">
                  <div className="drawer__section-title">Capabilities</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {selected.capabilities.map((c) => (
                      <Badge key={c} variant="dim">{c}</Badge>
                    ))}
                  </div>
                </div>
              )}
              {selected.state !== "revoked" && selected.state !== "offline" && (
                <div className="drawer__decision" style={{ marginTop: "auto" }}>
                  <div style={{ display: "flex", gap: 8 }}>
                    {selected.state === "active" && (
                      <Button variant="danger" onClick={() => void handleQuarantine(selected.nodeId)}>
                        Quarantine node
                      </Button>
                    )}
                    {selected.state !== "revoked" && selected.state !== "offline" && (
                      <Button variant="danger" onClick={() => void handleRevoke(selected.nodeId)}>
                        Revoke node
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
