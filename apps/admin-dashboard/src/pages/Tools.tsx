import { useState } from "react";
import { useApi } from "../hooks/useApi.js";
import { fetchTools } from "../api/client.js";
import {
  Badge, StatusBadge, TimeAgo, EmptyState, LoadingState
} from "../components/ui/primitives.js";
import { Table, FilterBar, FilterInput, FilterSelect } from "../components/ui/Table.js";

const SENSITIVITY_COLORS: Record<string, string> = {
  none: "dim", low: "success", medium: "warning", high: "error", always: "error",
};

export function Tools() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const { data, loading } = useApi(fetchTools);

  const rows = (data ?? []).filter((t) => {
    if (statusFilter !== "all" && t.status !== statusFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!t.toolId.includes(q) && !t.name.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Tools</h1>
          <p className="page-subtitle">Policy-governed tool registry — capabilities, permissions, approval sensitivity</p>
        </div>
        <Badge variant="default">{(data ?? []).length} registered</Badge>
      </div>

      <FilterBar>
        <FilterInput placeholder="Search tools…" value={search} onChange={setSearch} />
        <FilterSelect
          label="Status"
          value={statusFilter}
          onChange={setStatusFilter}
          options={[
            { value: "all", label: "All" },
            { value: "enabled", label: "Enabled" },
            { value: "disabled", label: "Disabled" },
          ]}
        />
      </FilterBar>

      {loading && !data && <LoadingState label="Loading tool registry…" />}

      {!loading && rows.length === 0 && (
        <EmptyState
          icon="⌖"
          title="No tools found"
          description="Tools registered with the orchestrator appear here with their policy bindings and usage history."
        />
      )}

      {rows.length > 0 && (
        <Table
          columns={[
            {
              key: "id",
              header: "Tool ID",
              render: (t) => <code style={{ fontSize: 12, color: "var(--cyan)" }}>{t.toolId}</code>,
            },
            { key: "name", header: "Name", render: (t) => <span style={{ color: "var(--text-primary)" }}>{t.name}</span> },
            {
              key: "actionClass",
              header: "Action Class",
              width: "140px",
              render: (t) => t.actionClass ? <Badge variant="dim">{t.actionClass}</Badge> : <span style={{ color: "var(--text-muted)" }}>—</span>,
            },
            {
              key: "sensitivity",
              header: "Approval",
              width: "110px",
              render: (t) => t.approvalSensitivity
                ? <Badge variant={SENSITIVITY_COLORS[t.approvalSensitivity] as "dim" | "success" | "warning" | "error"}>{t.approvalSensitivity}</Badge>
                : <span style={{ color: "var(--text-muted)" }}>—</span>,
            },
            {
              key: "status",
              header: "Status",
              width: "90px",
              render: (t) => <StatusBadge status={t.status} />,
            },
            {
              key: "used",
              header: "Last Used",
              width: "100px",
              render: (t) => <TimeAgo iso={t.lastInvokedAt} />,
            },
          ]}
          rows={rows}
          rowKey={(t) => t.toolId}
        />
      )}
    </div>
  );
}
